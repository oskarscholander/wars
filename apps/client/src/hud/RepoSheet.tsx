import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Repo } from "@ww/shared";
import { sortedRepos, useStore } from "../store.ts";
import { joinArgs, splitArgs } from "./args.ts";

function MonitoredRepo({ repo, fronts }: { repo: Repo; fronts: number }) {
  const send = useStore((s) => s.send);
  const [cmd, setCmd] = useState(joinArgs(repo.testCommand));
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setCmd(joinArgs(repo.testCommand)), [repo.testCommand]);
  const dirty = cmd.trim() !== joinArgs(repo.testCommand);

  const save = (e: FormEvent) => {
    e.preventDefault();
    send({ type: "repo.update", repoId: repo.id, testCommand: splitArgs(cmd) });
  };

  return (
    <li className="repo">
      <div className="repo-head">
        <div>
          <b>{repo.name}</b>
          <span className="path">{repo.path}</span>
        </div>
        <span className="count">
          {fronts} worktree{fronts === 1 ? "" : "s"}
        </span>
        {confirm ? (
          <span className="confirm">
            <button className="btn no" onClick={() => send({ type: "repo.remove", repoId: repo.id })}>
              Stop monitoring
            </button>
            <button className="btn plain" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="btn plain small" onClick={() => setConfirm(true)} aria-label={`Remove ${repo.name}`}>
            Remove
          </button>
        )}
      </div>
      <form className="testcmd" onSubmit={save}>
        <label>
          Test command
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="e.g. pnpm test"
            spellCheck={false}
          />
        </label>
        {dirty && (
          <button className="btn go small" type="submit">
            Save
          </button>
        )}
      </form>
    </li>
  );
}

/** Pick which repos Worktree Wars monitors. Removing one never touches files on disk. */
export function RepoSheet() {
  const open = useStore((s) => s.reposOpen);
  const war = useStore((s) => s.war);
  const suggestions = useStore((s) => s.suggestions);
  const { closeRepos, send } = useStore.getState();
  const [path, setPath] = useState("");
  const [filter, setFilter] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const repos = sortedRepos(war);
  const monitored = new Set(repos.map((r) => r.path));

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRepos();
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, closeRepos]);

  if (!open) return null;

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (path.trim() && send({ type: "repo.add", path: path.trim() })) setPath("");
  };

  const q = filter.trim().toLowerCase();
  const shown = (suggestions ?? []).filter(
    (s) => !monitored.has(s.path) && (!q || s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q)),
  );

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="reposTitle" onClick={closeRepos}>
      <div className="inner repos" onClick={(e) => e.stopPropagation()}>
        <h3 id="reposTitle">Repos</h3>
        <p>Every linked worktree of a monitored repo becomes an island. Removing a repo only stops watching it.</p>

        {repos.length > 0 && (
          <ul className="repo-list">
            {repos.map((r) => (
              <MonitoredRepo key={r.id} repo={r} fronts={Object.values(war.fronts).filter((f) => f.repoId === r.id).length} />
            ))}
          </ul>
        )}

        <form className="say" onSubmit={add} autoComplete="off">
          <div className="field">
            <input
              ref={input}
              aria-label="Repository folder"
              placeholder="Folder of a git repo, e.g. ~/Repos/my-app"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              spellCheck={false}
            />
          </div>
          <button className="send" type="submit" disabled={!path.trim()}>
            Add
          </button>
        </form>

        <div className="suggest-head">
          <b>Found on this machine</b>
          <input
            aria-label="Filter repos"
            placeholder="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
          />
        </div>
        <ul className="suggestions">
          {suggestions === null ? (
            <li className="note">Looking in ~/Repos, ~/code, ~/src, ~/Projects…</li>
          ) : shown.length === 0 ? (
            <li className="note">{q ? "No matches." : "No other git repos found in the usual folders. Type a path above."}</li>
          ) : (
            shown.map((s) => (
              <li key={s.path}>
                <button onClick={() => send({ type: "repo.add", path: s.path })}>
                  <b>{s.name}</b>
                  <span className="path">{s.path}</span>
                  <span className="plus">Add</span>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="sheet-acts">
          <button className="btn plain" onClick={closeRepos}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
