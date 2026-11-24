import Link from "next/link";
import type { ReactNode } from "react";

import { PUBLIC_NOTICE } from "../../lib/public-notice";
import styles from "./notice.module.css";

export default function PublicNoticeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={styles["shell"]}>
      <header className={styles["header"]}>
        <span className="brand-mark" aria-hidden="true">
          L
        </span>
        <strong>{PUBLIC_NOTICE.projectName}</strong>
        <nav aria-label="Privacy information">
          <Link href="/privacy">Privacy</Link>
          <Link href="/data-deletion">Data deletion</Link>
        </nav>
      </header>
      <main className={styles["content"]}>{children}</main>
      <footer className={styles["footer"]}>
        <p>
          Privacy and deletion contact:{" "}
          <a href={`mailto:${PUBLIC_NOTICE.contactEmail}`}>{PUBLIC_NOTICE.contactEmail}</a>
        </p>
        <p>
          Last updated: <time dateTime={PUBLIC_NOTICE.updatedOn}>{PUBLIC_NOTICE.updatedOn}</time>
        </p>
      </footer>
    </div>
  );
}
