import { execFileSync } from "node:child_process";

const upstream = "https://github.com/XiaoshengQIU/ow-activity-site.git";
const remote = execFileSync("git", ["ls-remote", upstream, "refs/heads/main"], {
  encoding: "utf8",
}).trim();
const sha = remote.split(/\s+/)[0] ?? "";
if (!/^[a-f0-9]{40}$/i.test(sha)) {
  console.error("读不到上游 main 的 commit，请先把改动合进 XiaoshengQIU/ow-activity-site。");
  process.exit(1);
}

execFileSync(
  "npx",
  [
    "vercel",
    "deploy",
    "--prod",
    "--yes",
    `--build-env=APP_GIT_COMMIT_SHA=${sha}`,
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);
