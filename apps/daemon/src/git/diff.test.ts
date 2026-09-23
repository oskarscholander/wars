import { describe, expect, it } from "vitest";
import { MAX_LINES_PER_FILE, parseNumstat, parseUnifiedDiff } from "./diff.ts";

const DIFF = `diff --git a/src/editor/ThreadPopover.tsx b/src/editor/ThreadPopover.tsx
index 1111111..2222222 100644
--- a/src/editor/ThreadPopover.tsx
+++ b/src/editor/ThreadPopover.tsx
@@ -10,4 +10,6 @@ export function ThreadPopover() {
   const thread = useThread()
-  const { resolve } = useThreadActions(thread.id)
+  const { resolve, remove } = useThreadActions(thread.id)
   return (
+      <Button onClick={remove}>Delete</Button>
+      <Button onClick={resolve}>Resolve</Button>
@@ -40,2 +42,2 @@
-old tail
+new tail
\\ No newline at end of file
diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
index 3333333..4444444 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -1 +1 @@
-a
+b
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/logo.png differ
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 6666666..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-x
-y
`;

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(DIFF);

  it("finds every file", () => {
    expect(files.map((f) => f.path)).toEqual(["src/editor/ThreadPopover.tsx", "new/name.ts", "logo.png", "gone.ts"]);
  });

  it("numbers old and new lines per hunk", () => {
    const [first, second] = files[0]!.hunks;
    expect(first!.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ["context", 10, 10],
      ["del", 11, null],
      ["add", null, 11],
      ["context", 12, 12],
      ["add", null, 13],
      ["add", null, 14],
    ]);
    expect(second).toMatchObject({ oldStart: 40, newStart: 42 });
    expect(second!.lines).toHaveLength(2);
    expect(files[0]).toMatchObject({ added: 4, removed: 2, binary: false, oldPath: null });
  });

  it("handles renames, binaries and deletions", () => {
    expect(files[1]).toMatchObject({ path: "new/name.ts", oldPath: "old/name.ts", added: 1, removed: 1 });
    expect(files[2]).toMatchObject({ binary: true, hunks: [] });
    expect(files[3]).toMatchObject({ path: "gone.ts", removed: 2, added: 0 });
  });

  it("truncates huge files but keeps full counts", () => {
    const body = Array.from({ length: MAX_LINES_PER_FILE + 10 }, (_, i) => `+line ${i}`).join("\n");
    const [f] = parseUnifiedDiff(`diff --git a/big b/big\n--- /dev/null\n+++ b/big\n@@ -0,0 +1,${MAX_LINES_PER_FILE + 10} @@\n${body}\n`);
    expect(f!.added).toBe(MAX_LINES_PER_FILE + 10);
    expect(f!.hunks[0]!.lines).toHaveLength(MAX_LINES_PER_FILE);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("parseNumstat", () => {
  it("parses counts, binaries and renames", () => {
    const m = parseNumstat("4\t2\tsrc/a.ts\n-\t-\tlogo.png\n1\t1\tsrc/{old => new}/x.ts\n3\t0\told.ts => fresh.ts\n");
    expect(m.get("src/a.ts")).toEqual({ added: 4, removed: 2, binary: false });
    expect(m.get("logo.png")).toEqual({ added: 0, removed: 0, binary: true });
    expect(m.get("src/new/x.ts")).toEqual({ added: 1, removed: 1, binary: false });
    expect(m.get("fresh.ts")).toEqual({ added: 3, removed: 0, binary: false });
  });
});
