import type { ImportNotice } from "@sin/core";
import { useState } from "react";

import { InlineNotice } from "../../../ui/InlineNotice";
import { IMPORTED_NOTICE, importNoticeText } from "./messages";

/**
 * Spec 10.4 AC30, AC34: above the imported draft — the dismissible info line (a polite status), then one
 * warning per cut the plan reported (an alert, static copy with counts and on-screen names only).
 */
export function ImportNotices({ notices }: { notices: readonly ImportNotice[] }) {
  const [infoOpen, setInfoOpen] = useState(true);
  return (
    <>
      {infoOpen ? <InlineNotice onDismiss={() => setInfoOpen(false)}>{IMPORTED_NOTICE}</InlineNotice> : null}
      {notices.map((notice) => (
        <InlineNotice key={notice.code} tone="warning">
          {importNoticeText(notice)}
        </InlineNotice>
      ))}
    </>
  );
}
