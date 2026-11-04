// Opt-in real Chromium check. All Widget API responses are local synthetic mocks.
// Run: S22_BROWSER_EXECUTABLE=<chromium path> node --test scripts/test/widget-browser.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildWidgetFrameDocument,
  buildWidgetLoader,
} from "../../apps/web/src/lib/widget-embed.ts";

const nonce = "synthetic_browser_nonce_1234567890";
const api = "https://widget.example";
const sandbox = /next.sandbox = "([^"]+)"/u.exec(buildWidgetLoader(api))?.[1];

for (const scenario of ["arrow", "phone", "keyboard", "retry", "expired"]) {
  test(
    `actual sandboxed Widget ${scenario} interaction without native form privileges`,
    {
      skip: !process.env.S22_BROWSER_EXECUTABLE,
      timeout: 65_000,
    },
    async () => {
      assert.equal(sandbox, "allow-scripts allow-same-origin");
      const server = createServer((request, response) => {
        if (request.url === "/frame") {
          const document = buildWidgetFrameDocument({
            apiOrigin: api,
            embeddingOrigin: "https://host.example",
            exchangeGrant: `wex1.${"a".repeat(64)}.${"b".repeat(64)}.${"c".repeat(32)}`,
            instance: "synthetic_browser_instance",
            nonce,
          });
          const mock = `<script nonce="${nonce}">
        const calls=[];
        window.addEventListener('error',event=>parent.postMessage({probe:true,error:event.message}, 'http://127.0.0.1:'+location.port));
        window.fetch=async(url,options={})=>{
          const path=new URL(url).pathname;
          if(path.endsWith('/redeem'))return Response.json({data:{bearer_token:'synthetic',expires_at:new Date(Date.now()+3600000).toISOString()}});
          if(options.method==='POST'){
            calls.push({path,body:JSON.parse(options.body),key:options.headers['idempotency-key']});
            if('${scenario}'==='expired')return Response.json({code:'token_invalid'},{status:401});
            if('${scenario}'==='retry'&&calls.length===1)throw new TypeError('Synthetic lost response');
            return Response.json({data:{bearer_token:'synthetic-bound',expires_at:new Date(Date.now()+3600000).toISOString(),conversation:{id:'synthetic-conversation'},message:{id:'synthetic-message',sequence_no:1}}}, {status:201});
          }
          return Response.json({data:[]});
        };
      </script>`;
          const probe = `<script nonce="${nonce}">
        setTimeout(async()=>{
          const input=document.querySelector('.input'),send=document.querySelector('.send');
          input.value='Synthetic booking question with enough words to wrap across several lines on a narrow phone screen. Price and duration? Tomorrow at 17:00 please.';
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.scrollTop=input.scrollHeight;
          const layout={height:input.getBoundingClientRect().height,scrollHeight:input.scrollHeight,clientHeight:input.clientHeight,scrollTop:input.scrollTop,font:getComputedStyle(input).fontFamily,width:document.documentElement.scrollWidth,viewport:innerWidth};
          let editingCalls=0;
          if('${scenario}'==='keyboard'){
            input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));
            input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
            editingCalls=calls.length;
            input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
          }else{send.click();send.click();send.click();}
          await new Promise(resolve=>setTimeout(resolve,50));
          const failureVisible=!!document.querySelector('.failed .retry');
          if('${scenario}'==='retry'){
            const retry=document.querySelector('.retry');
            if(retry){retry.click();retry.click();retry.click();}
            await new Promise(resolve=>setTimeout(resolve,50));
          }
          if('${scenario}'==='expired'){
            input.value='Must not send after expiry';input.dispatchEvent(new Event('input'));send.click();
          }
          const resetHeight=input.getBoundingClientRect().height;
          parent.postMessage({probe:true,calls,editingCalls,failureVisible,disabled:send.disabled,inputDisabled:input.disabled,draft:input.value,bubbles:document.querySelectorAll('.customer').length,resetHeight,layout}, 'http://127.0.0.1:'+location.port);
        },100);
      </script>`;
          response.writeHead(200, {
            "content-type": "text/html",
            "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; form-action 'none'`,
          });
          response.end(
            document
              .replace(`<script nonce="${nonce}">`, mock + `<script nonce="${nonce}">`)
              .replace("</body>", probe + "</body>"),
          );
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end(
          `<html><body><pre id="result">PENDING</pre><iframe style="width:${scenario === "phone" ? 320 : 390}px;height:${scenario === "phone" ? 512 : 680}px" sandbox="${sandbox}" src="http://127.0.0.1:${server.address().port}/frame"></iframe><script>window.addEventListener('message',event=>{if(event.source===document.querySelector('iframe').contentWindow&&event.data.probe)document.querySelector('#result').textContent=JSON.stringify(event.data)})</script></body></html>`,
        );
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const profile = await mkdtemp(join(tmpdir(), "s22-widget-browser-"));
      const child = spawn(
        process.env.S22_BROWSER_EXECUTABLE,
        [
          "--headless",
          "--disable-gpu",
          "--no-first-run",
          "--disable-background-networking",
          `--user-data-dir=${profile}`,
          "--dump-dom",
          "--virtual-time-budget=3000",
          `http://127.0.0.1:${server.address().port}/`,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.resume();
      const deadline = setTimeout(() => child.kill(), 55_000);
      try {
        await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code) =>
            code === 0 ? resolve() : reject(Error(`Browser exit ${code}`)),
          );
        });
        const encoded = /<pre id="result">(.*?)<\/pre>/su.exec(output)?.[1];
        assert.ok(
          encoded && encoded !== "PENDING",
          `Browser must report the actual frame interaction: ${output.slice(-6000)}`,
        );
        const result = JSON.parse(encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
        assert.equal(result.error, undefined, JSON.stringify(result));
        assert.equal(
          result.calls.length,
          scenario === "retry" ? 2 : 1,
          `Bounded send count: ${JSON.stringify(result)}`,
        );
        assert.equal(result.calls[0].path, "/v1/widget/conversations");
        if (scenario === "expired") {
          assert.equal(result.disabled, true);
          assert.equal(result.inputDisabled, true);
        } else {
          assert.equal(result.draft, "");
          assert.equal(result.resetHeight, 52);
        }
        if (scenario === "retry") {
          assert.equal(result.failureVisible, true);
          assert.deepEqual(
            result.calls[0],
            result.calls[1],
            "Retry must reuse the exact idempotency key, message ID, body and route",
          );
        }
        assert.equal(result.editingCalls, 0);
        assert.equal(result.bubbles, 1);
        assert.ok(result.layout.height > 60, "Composer should grow with the draft");
        assert.ok(result.layout.height <= 160, "Long drafts must leave room for the conversation");
        assert.ok(
          !result.layout.font.includes("monospace"),
          "Composer inherits the customer UI font",
        );
        if (result.layout.height < 160) {
          assert.ok(
            result.layout.scrollHeight <= result.layout.clientHeight + 1,
            "Uncapped draft must fit without scrolling",
          );
        } else {
          assert.ok(
            result.layout.scrollHeight - result.layout.clientHeight - result.layout.scrollTop <= 1,
            "At the height cap, the full draft remains reachable by scrolling",
          );
        }
        assert.ok(result.layout.width <= result.layout.viewport, "No horizontal overflow");
      } finally {
        clearTimeout(deadline);
        child.kill();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );
}
