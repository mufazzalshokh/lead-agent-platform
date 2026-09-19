const HTTPS_ORIGIN_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(?::[1-9][0-9]{0,4})?$/u;
const INSTANCE_PATTERN = /^[A-Za-z0-9_-]{16,80}$/u;
const GRANT_PATTERN = /^wex1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

export const requireHttpsOrigin = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !HTTPS_ORIGIN_PATTERN.test(value)) {
    throw new TypeError(`${name} must be an exact HTTPS origin`);
  }
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.username !== "" || parsed.password !== "") {
    throw new TypeError(`${name} must be an exact HTTPS origin`);
  }
  return parsed.origin;
};

export const requireWidgetGrant = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length < 100 ||
    value.length > 2_048 ||
    !GRANT_PATTERN.test(value)
  ) {
    throw new TypeError("Invalid Widget exchange grant");
  }
  return value;
};

export const requireWidgetInstance = (value: unknown): string => {
  if (typeof value !== "string" || !INSTANCE_PATTERN.test(value)) {
    throw new TypeError("Invalid Widget instance");
  }
  return value;
};

const scriptValue = (value: string): string => JSON.stringify(value).replaceAll("<", "\\u003c");

export const buildWidgetLoader = (apiOrigin: string): string => {
  const api = requireHttpsOrigin(apiOrigin, "WIDGET_PUBLIC_API_ORIGIN");
  return `(() => {
  "use strict";
  const VERSION = "lead-agent.widget.v1";
  const API_ORIGIN = ${scriptValue(api)};
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement) || script.dataset.leadAgentMounted === "true") return;
  script.dataset.leadAgentMounted = "true";
  const widgetKey = script.dataset.widgetKey || "";
  const locale = ["uz", "ru", "en"].includes(script.dataset.locale || "") ? script.dataset.locale : "uz";
  if (!/^[A-Za-z0-9_-]{32,255}$/.test(widgetKey)) return;
  const instance = crypto.randomUUID().replaceAll("-", "");
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.textContent = script.dataset.label || "Chat with us";
  launcher.setAttribute("aria-label", script.dataset.label || "Open customer chat");
  Object.assign(launcher.style, { position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483000", minHeight: "52px", padding: "0 20px", border: "0", borderRadius: "999px", background: "#276153", color: "#fff", boxShadow: "0 12px 32px rgba(20,45,38,.24)", cursor: "pointer", font: "700 15px system-ui,sans-serif" });
  let frame = null;
  let frameOrigin = null;
  let opening = false;
  const showLauncher = () => { launcher.hidden = false; if (frame) frame.style.display = "none"; };
  const showError = () => { launcher.disabled = false; launcher.textContent = "Try chat again"; opening = false; };
  const open = async () => {
    if (frame) { frame.style.display = "block"; launcher.hidden = true; return; }
    if (opening) return;
    opening = true;
    launcher.disabled = true;
    launcher.textContent = "Opening…";
    try {
      const response = await fetch(API_ORIGIN + "/v1/widget/embed-grants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ widget_key: widgetKey, requested_locale: locale, page_url: location.href }) });
      if (!response.ok) throw new Error("unavailable");
      const payload = await response.json();
      const data = payload && typeof payload === "object" ? payload.data : null;
      if (!data || typeof data.exchange_grant !== "string" || !/^wex1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(data.exchange_grant) || data.exchange_grant.length > 2048 || typeof data.iframe_url !== "string" || typeof data.iframe_origin !== "string") throw new Error("invalid");
      const frameUrl = new URL(data.iframe_url);
      if (frameUrl.protocol !== "https:" || frameUrl.origin !== data.iframe_origin || frameUrl.username || frameUrl.password || frameUrl.pathname !== "/widget/frame" || frameUrl.search || frameUrl.hash) throw new Error("invalid");
      frameOrigin = frameUrl.origin;
      const next = document.createElement("iframe");
      next.title = script.dataset.title || "Customer chat";
      next.name = "lead_agent_widget_" + instance;
      next.sandbox = "allow-scripts allow-same-origin";
      next.setAttribute("referrerpolicy", "no-referrer");
      next.setAttribute("allow", "");
      Object.assign(next.style, { position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483001", width: "min(390px, calc(100vw - 24px))", height: "min(680px, calc(100vh - 24px))", border: "0", borderRadius: "18px", background: "#fff", boxShadow: "0 22px 70px rgba(20,45,38,.28)" });
      frame = next;
      document.body.append(next);
      const handoff = document.createElement("form");
      handoff.method = "POST";
      handoff.action = frameUrl.toString();
      handoff.target = next.name;
      handoff.style.display = "none";
      for (const [name, value] of [["exchange_grant", data.exchange_grant], ["instance", instance]]) { const field = document.createElement("input"); field.type = "hidden"; field.name = name; field.value = value; handoff.append(field); }
      document.body.append(handoff);
      handoff.submit();
      handoff.remove();
      launcher.hidden = true;
    } catch { showError(); }
  };
  launcher.addEventListener("click", () => { void open(); });
  window.addEventListener("message", (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== frameOrigin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.version !== VERSION || data.instance !== instance || typeof data.type !== "string") return;
    if (data.type === "CLOSE" && Object.keys(data).length === 3) showLauncher();
    else if (data.type === "EXPIRED" && Object.keys(data).length === 3) { frame.remove(); frame = null; frameOrigin = null; launcher.textContent = "Start a new chat"; launcher.disabled = false; launcher.hidden = false; }
    else if (data.type === "READY" && Object.keys(data).length === 3) { opening = false; launcher.disabled = false; }
    else if (data.type === "RESIZE" && Object.keys(data).length === 4 && Number.isInteger(data.height) && data.height >= 320 && data.height <= 800) frame.style.height = Math.min(data.height, window.innerHeight - 24) + "px";
  });
  document.body.append(launcher);
})();`;
};

export type WidgetFrameDocumentInput = Readonly<{
  apiOrigin: string;
  embeddingOrigin: string;
  exchangeGrant: string;
  instance: string;
  nonce: string;
}>;

export const buildWidgetFrameDocument = (input: WidgetFrameDocumentInput): string => {
  const apiOrigin = requireHttpsOrigin(input.apiOrigin, "WIDGET_PUBLIC_API_ORIGIN");
  const embeddingOrigin = requireHttpsOrigin(input.embeddingOrigin, "embedding origin");
  const exchangeGrant = requireWidgetGrant(input.exchangeGrant);
  const instance = requireWidgetInstance(input.instance);
  if (!/^[A-Za-z0-9_-]{22,128}$/u.test(input.nonce)) throw new TypeError("Invalid CSP nonce");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light"><title>Customer chat</title>
<style nonce="${input.nonce}">
:root{font-family:Inter,system-ui,sans-serif;color:#17201d;background:#f8faf8}*{box-sizing:border-box}body{margin:0;height:100dvh;min-height:320px}.chat{display:grid;height:100%;grid-template-rows:auto 1fr auto;background:#fff}.header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e1e7e3;background:#f8faf8}.header strong{display:block;font-size:15px}.header small{color:#6d7874}.close{width:36px;height:36px;border:0;border-radius:50%;background:#e9efec;color:#294c42;cursor:pointer;font-size:20px}.messages{display:flex;flex-direction:column;gap:10px;overflow-y:auto;padding:16px;scroll-behavior:smooth}.welcome{margin:auto;padding:24px;text-align:center;color:#69746f}.welcome strong{display:block;margin-bottom:6px;color:#17201d;font-size:18px}.bubble{max-width:86%;padding:10px 12px;border-radius:15px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45;font-size:14px}.customer{align-self:flex-end;border-bottom-right-radius:4px;background:#276153;color:#fff}.business{align-self:flex-start;border-bottom-left-radius:4px;background:#edf1ef}.failed{outline:2px solid #c34b4b}.meta{display:flex;gap:8px;align-items:center;margin-top:5px;font-size:11px;opacity:.72}.retry{border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer}.waiting{align-self:flex-start;padding:8px 11px;border-radius:14px;background:#edf1ef;color:#62706a;font-size:13px}.composer{padding:10px;border-top:1px solid #e1e7e3;background:#fff}.status{min-height:18px;margin:0 4px 6px;color:#a43d3d;font-size:12px}.row{display:flex;align-items:flex-end;gap:8px}.input{min-height:44px;max-height:112px;flex:1;resize:none;padding:11px 12px;border:1px solid #ccd6d1;border-radius:14px;color:#17201d;background:#fff;line-height:1.35}.send{width:44px;height:44px;border:0;border-radius:50%;background:#276153;color:#fff;cursor:pointer;font-size:18px}.send:disabled{cursor:not-allowed;opacity:.45}button:focus-visible,textarea:focus-visible{outline:3px solid #86b9ab;outline-offset:2px}@media(max-width:480px){.bubble{max-width:92%}.header{padding-top:max(14px,env(safe-area-inset-top))}.composer{padding-bottom:max(10px,env(safe-area-inset-bottom))}}@media(prefers-reduced-motion:reduce){.messages{scroll-behavior:auto}}
</style></head><body><main class="chat"><header class="header"><div><strong>How can we help?</strong><small>Usually replies in a few moments</small></div><button class="close" type="button" aria-label="Close chat">×</button></header><section class="messages" aria-live="polite"><div class="welcome"><strong>Hello 👋</strong><span>Ask a question or tell us what you need.</span></div></section><form class="composer"><p class="status" role="status"></p><div class="row"><textarea class="input" rows="1" maxlength="4000" aria-label="Message" placeholder="Write a message…"></textarea><button class="send" type="submit" aria-label="Send message">➤</button></div></form></main>
<script nonce="${input.nonce}">(() => {"use strict";
const VERSION="lead-agent.widget.v1",API=${scriptValue(apiOrigin)},HOST=${scriptValue(embeddingOrigin)},GRANT=${scriptValue(exchangeGrant)},INSTANCE=${scriptValue(instance)};
const messages=document.querySelector(".messages"),form=document.querySelector(".composer"),input=document.querySelector(".input"),send=document.querySelector(".send"),status=document.querySelector(".status"),welcome=document.querySelector(".welcome"),close=document.querySelector(".close");
let token=null,conversation=null,expiresAt=0,after=0,pollTimer=null,waitingSince=null;const records=new Map();
const post=(type,extra={})=>parent.postMessage({version:VERSION,instance:INSTANCE,type,...extra},HOST);
const safeData=async response=>{try{const value=await response.json();return value&&typeof value==="object"?value:null}catch{return null}};
const problemCode=value=>value&&typeof value.code==="string"?value.code:"";
const setStatus=value=>{status.textContent=value};
const scroll=()=>{messages.scrollTop=messages.scrollHeight};
const render=()=>{for(const node of [...messages.querySelectorAll(".bubble,.waiting")])node.remove();welcome.hidden=records.size>0;for(const item of [...records.values()].sort((a,b)=>a.order-b.order)){const bubble=document.createElement("article");bubble.className="bubble "+(item.direction==="inbound"?"customer":"business")+(item.state==="failed"?" failed":"");const text=document.createElement("div");text.textContent=item.text;bubble.append(text);const meta=document.createElement("div");meta.className="meta";const label=document.createElement("span");label.textContent=item.state==="sending"?"Sending…":item.state==="failed"?"Not sent":"";meta.append(label);if(item.state==="failed"){const retry=document.createElement("button");retry.type="button";retry.className="retry";retry.textContent="Retry";retry.addEventListener("click",()=>void sendRecord(item));meta.append(retry)}bubble.append(meta);messages.append(bubble)}if(waitingSince!==null){const wait=document.createElement("div");wait.className="waiting";wait.textContent="Writing a reply…";messages.append(wait)}scroll()};
const expire=()=>{token=null;if(pollTimer)clearTimeout(pollTimer);pollTimer=null;setStatus("This chat session ended. Start a new chat to continue.");send.disabled=true;input.disabled=true;post("EXPIRED")};
const request=async(path,options={})=>{const headers={...(options.headers||{})};if(token)headers.authorization="Bearer "+token;const response=await fetch(API+path,{...options,headers});if(response.status===401||response.status===403){expire();throw new Error("expired")}return response};
const poll=async()=>{if(!token||!conversation)return;try{const response=await request("/v1/widget/conversations/"+encodeURIComponent(conversation)+"/messages?after="+after+"&limit=100");if(response.ok){const payload=await safeData(response);for(const item of payload&&Array.isArray(payload.data)?payload.data:[]){if(!item||typeof item.id!=="string"||typeof item.sequence_no!=="number")continue;after=Math.max(after,item.sequence_no);records.set(item.id,{id:item.id,text:typeof item.body_text==="string"?item.body_text:"Message removed",direction:item.direction,order:item.sequence_no,state:"accepted"});if(item.direction==="outbound"&&waitingSince!==null){performance.measure("lead-agent-customer-ttfr",{start:waitingSince,end:performance.now()});waitingSince=null}}render()}}catch{}finally{if(token)pollTimer=setTimeout(()=>void poll(),2000)}};
const sendRecord=async item=>{if(!token)return;item.state="sending";records.set(item.clientId,item);setStatus("");waitingSince=performance.now();render();const body={client_message_id:item.clientId,kind:"text",locale_hint:null,text:item.text};const first=conversation===null;try{const response=await request(first?"/v1/widget/conversations":"/v1/widget/conversations/"+encodeURIComponent(conversation)+"/messages",{method:"POST",headers:{"content-type":"application/json","idempotency-key":item.idempotencyKey},body:JSON.stringify(body)});const payload=await safeData(response);if(!response.ok){if(response.status===429)setStatus("Please wait a moment before sending again.");else if(["business_rule_failed","resource_not_found"].includes(problemCode(payload)))expire();throw new Error("send_failed")}const data=payload&&payload.data;if(first){if(!data||typeof data.bearer_token!=="string"||!data.conversation||typeof data.conversation.id!=="string")throw new Error("invalid");token=data.bearer_token;conversation=data.conversation.id;expiresAt=Date.parse(data.expires_at);const accepted=data.message;if(!accepted||typeof accepted.id!=="string"||typeof accepted.sequence_no!=="number")throw new Error("invalid");records.delete(item.clientId);records.set(accepted.id,{...item,id:accepted.id,order:accepted.sequence_no,state:"accepted"});after=Math.max(after,accepted.sequence_no);if(!pollTimer)void poll()}else{const accepted=data&&data.message;if(!accepted||typeof accepted.id!=="string"||typeof accepted.sequence_no!=="number")throw new Error("invalid");records.delete(item.clientId);records.set(accepted.id,{...item,id:accepted.id,order:accepted.sequence_no,state:"accepted"});after=Math.max(after,accepted.sequence_no)}render()}catch(error){if(token){item.state="failed";records.set(item.clientId,item);waitingSince=null;setStatus("Your message was not sent. You can retry safely.");render()}}finally{send.disabled=input.value.trim().length===0}};
const submit=()=>{const text=input.value.trim();if(text.length<1||text.length>4000||!token)return;const id="browser."+crypto.randomUUID(),key="request."+crypto.randomUUID();const item={clientId:id,idempotencyKey:key,text,direction:"inbound",order:Date.now(),state:"sending"};input.value="";send.disabled=true;void sendRecord(item)};
form.addEventListener("submit",event=>{event.preventDefault();submit()});input.addEventListener("input",()=>{send.disabled=input.value.trim().length<1||input.value.trim().length>4000});input.addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();submit()}});close.addEventListener("click",()=>post("CLOSE"));
const start=async()=>{try{const response=await fetch(API+"/v1/widget/embed-sessions/redeem",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({exchange_grant:GRANT})});const payload=await safeData(response),data=payload&&payload.data;if(!response.ok||!data||typeof data.bearer_token!=="string")throw new Error("redeem");token=data.bearer_token;expiresAt=Date.parse(data.expires_at);history.replaceState(null,"","/widget/frame");send.disabled=true;post("READY");input.focus();const remaining=expiresAt-Date.now();if(remaining>0)setTimeout(expire,Math.min(remaining,2147483647));else expire()}catch{setStatus("Chat is temporarily unavailable. Please close and try again.");send.disabled=true;post("EXPIRED")}};void start();
})();</script></body></html>`;
};
