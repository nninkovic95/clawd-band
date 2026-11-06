// Keeps the clawd-band entry in davepoon/buildwithclaude current.
// Minor and major releases go out on push; a patch only on a manual run.
// An open bump PR (or the first listing PR) is updated instead of opening
// another, so the maintainer never has more than one to review.
// Writes go through the GitHub API, so no clone of the large fork is needed,
// and a commit made against a stale file is refused instead of overwriting it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UPSTREAM = 'davepoon/buildwithclaude';
const OWNER = 'nninkovic95';
const FORK = `${OWNER}/buildwithclaude`;
const PLUGIN_REPO = `${OWNER}/clawd-band`;
const NAME = 'clawd-band';
const LISTING_BRANCH = 'add-clawd-band';
const BUMP_BRANCH = 'update-clawd-band';
const FILE = '.claude-plugin/marketplace.json';
const AUTHOR = { name: 'SleepNoMore', email: '324457260+nninkovic95@users.noreply.github.com' };

const inActions = Boolean(process.env.GITHUB_ACTIONS);

function gh(args, input) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    const err = new Error(`gh ${args.filter((a) => !a.startsWith('Accept:')).join(' ')}: ${String(e.stderr || e.message).trim()}`);
    err.notFound = /HTTP 404/.test(String(e.stderr));
    throw err;
  }
}
const ghJson = (args, input) => JSON.parse(gh(args, input));
const raw = (repo, ref) => gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${FILE}?ref=${ref}`]);
const headSha = (repo, branch) => ghJson(['api', `repos/${repo}/git/ref/heads/${branch}`]).object.sha;

function notice(msg) {
  console.log(inActions ? `::notice::${msg}` : msg);
}

export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  if (!m) throw new Error(`not a x.y.z version: ${v}`);
  return m.slice(1).map(Number);
}

export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}

export const sameMinor = (a, b) => parseVersion(a).slice(0, 2).join('.') === parseVersion(b).slice(0, 2).join('.');

export function findEntry(text) {
  const hits = JSON.parse(text).plugins.filter((p) => p.name === NAME);
  if (hits.length > 1) throw new Error(`${FILE} has ${hits.length} "${NAME}" entries`);
  return hits[0] ? { version: hits[0].version, sha: hits[0].source?.sha } : null;
}

// Line edits keep the rest of the file byte for byte; re-serialising it would
// rewrite thousands of lines the maintainer then has to review.
export function editEntry(text, version, sha) {
  const lines = text.split('\n');
  const named = lines.flatMap((l, i) => (l.trim().startsWith(`"name": "${NAME}"`) ? [i] : []));
  if (named.length !== 1) throw new Error(`expected one "${NAME}" line in ${FILE}, found ${named.length}`);
  const indent = lines[named[0]].match(/^\s*/)[0];
  const outer = indent.slice(2);
  let top = named[0];
  while (top > 0 && lines[top] !== `${outer}{`) top--;
  let bottom = named[0];
  while (bottom < lines.length - 1 && lines[bottom] !== `${outer}}` && lines[bottom] !== `${outer}},`) bottom++;

  const swap = (pattern, value) => {
    const hits = [];
    for (let i = top; i <= bottom; i++) if (pattern.test(lines[i])) hits.push(i);
    if (hits.length !== 1) throw new Error(`expected one ${pattern} line in the "${NAME}" entry, found ${hits.length}`);
    lines[hits[0]] = lines[hits[0]].replace(pattern, value);
  };
  swap(/"version": "[^"]*"/, `"version": "${version}"`);
  swap(/"sha": "[0-9a-f]{40}"/, `"sha": "${sha}"`);
  const out = lines.join('\n');

  const before = JSON.parse(text);
  const after = JSON.parse(out);
  const entry = after.plugins.find((p) => p.name === NAME);
  const old = before.plugins.find((p) => p.name === NAME);
  if (entry.version !== version || entry.source?.sha !== sha) throw new Error('the edit did not set version and sha');
  entry.version = old.version;
  entry.source.sha = old.source.sha;
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('the edit changed more than version and sha');
  return out;
}

export function changedLines(a, b) {
  const [x, y] = [a.split('\n'), b.split('\n')];
  return x.flatMap((l, i) => (l !== y[i] ? [`- ${l.trim()}`, `+ ${y[i].trim()}`] : []));
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The Testing section keeps its versions: those checks ran at the old commit,
// so "the pinned sha" there is replaced by that commit's name.
export function listingText(pr, from, to) {
  const swap = (s) =>
    s
      .replaceAll(from.sha, to.sha)
      .replace(new RegExp(`(?<![0-9a-f])${from.sha.slice(0, 7)}(?![0-9a-f])`, 'g'), to.sha.slice(0, 7))
      .replace(new RegExp(`(?<![\\w.])${escape(from.version)}(?!\\.?\\d)`, 'g'), to.version);
  const cut = pr.body.indexOf('\n## Testing');
  if (cut < 0) throw new Error(`PR #${pr.number} has no "## Testing" section; not editing it`);
  const testing = pr.body.slice(cut).replaceAll('at the pinned sha', `at ${from.sha.slice(0, 7)}`);
  return { title: swap(pr.title), body: swap(pr.body.slice(0, cut)) + testing };
}

export function bumpText(listed, to) {
  return {
    title: `Bump ${NAME} to ${to.version}`,
    body: [
      `Hi @davepoon! This bumps the ${NAME} entry to **${to.version}** (https://github.com/${PLUGIN_REPO}/tree/${to.sha}), whose \`plugin.json\` is ${to.version}.`,
      '',
      `- \`${FILE}\` → \`${NAME}\`: \`version\` ${listed.version} → ${to.version}, \`source.sha\` ${listed.sha.slice(0, 7)} → ${to.sha.slice(0, 7)}.`,
      '',
      `I maintain ${NAME} and send these bumps for minor and major releases, and for a patch only when it is worth listing. A workflow in the ${NAME} repo opens this PR and keeps it current while it is open, so there is never more than one. If you'd rather not get them, tell me and I'll stop.`,
      '',
    ].join('\n'),
  };
}

function commitFile(branch, to) {
  const head = headSha(FORK, branch);
  const current = raw(FORK, head);
  const blob = gh(['api', `repos/${FORK}/contents/${FILE}?ref=${head}`, '--jq', '.sha']).trim();
  const updated = editEntry(current, to.version, to.sha);
  gh(
    ['api', '-X', 'PUT', `repos/${FORK}/contents/${FILE}`, '--input', '-'],
    JSON.stringify({
      message: `Bump ${NAME} to ${to.version}\n\nPinned to ${PLUGIN_REPO}@${to.sha.slice(0, 7)}, whose plugin.json is ${to.version}.`,
      content: Buffer.from(updated).toString('base64'),
      sha: blob,
      branch,
      author: AUTHOR,
      committer: AUTHOR,
    }),
  );
}

function main() {
  const dry = process.env.DRY_RUN === '1';
  const manual = process.env.MODE === 'manual';
  if (inActions && !process.env.GH_TOKEN) throw new Error('the BWC_TOKEN secret is not set');

  const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
  if (plugin.name !== NAME) throw new Error(`plugin.json names "${plugin.name}", not "${NAME}"`);
  const to = {
    version: (dry && process.env.PRETEND_VERSION) || plugin.version,
    sha: (dry && process.env.PRETEND_SHA) || process.env.PLUGIN_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  };
  parseVersion(to.version);
  if (!/^[0-9a-f]{40}$/.test(to.sha)) throw new Error(`not a full commit sha: ${to.sha}`);

  const prs = ghJson(['pr', 'list', '-R', UPSTREAM, '--author', OWNER, '--state', 'open', '--json', 'number,title,body,headRefName,headRepositoryOwner,url']).filter(
    (p) => p.headRepositoryOwner?.login === OWNER && [LISTING_BRANCH, BUMP_BRANCH].includes(p.headRefName),
  );
  if (prs.length > 1) throw new Error(`more than one open ${NAME} PR: ${prs.map((p) => p.url).join(', ')}`);
  const pr = prs[0] ?? null;

  const listed = findEntry(raw(UPSTREAM, 'main'));
  if (pr?.headRefName === BUMP_BRANCH && !listed) throw new Error(`bump PR #${pr.number} is open but ${UPSTREAM} main has no ${NAME} entry`);
  if (!pr && !listed) throw new Error(`${UPSTREAM} main has no ${NAME} entry and no ${NAME} PR is open`);
  const pendingText = pr ? raw(FORK, pr.headRefName) : raw(UPSTREAM, 'main');
  const pending = findEntry(pendingText);
  if (!pending) throw new Error(`${FORK}:${pr.headRefName} has no ${NAME} entry`);

  const where = pr ? `PR #${pr.number}` : `${UPSTREAM} main`;
  const order = compareVersions(to.version, pending.version);
  if (order === 0) return notice(`${where} already lists ${NAME} ${to.version}; nothing to do`);
  if (order < 0) return notice(`${where} lists ${pending.version}, newer than ${to.version}; nothing to do`);
  if (!manual && sameMinor(to.version, pending.version)) {
    return notice(`${to.version} is a patch over ${pending.version}; run this workflow by hand to list it`);
  }

  const text = pr?.headRefName === LISTING_BRANCH ? listingText(pr, pending, to) : bumpText(listed, to);
  const plan = pr
    ? `commit to ${FORK}:${pr.headRefName}, then update the title and body of ${pr.url}`
    : `sync ${FORK} main, reset ${FORK}:${BUMP_BRANCH} to it, commit, open a PR to ${UPSTREAM}`;
  console.log(`${NAME} ${pending.version} → ${to.version} (${to.sha})\nPlan: ${plan}\n`);
  console.log(changedLines(pendingText, editEntry(pendingText, to.version, to.sha)).join('\n'));
  console.log(`\nTitle: ${text.title}\n\n${text.body}`);
  if (dry) return notice('dry run: nothing was written');

  if (pr) {
    commitFile(pr.headRefName, to);
    gh(['api', '-X', 'PATCH', `repos/${UPSTREAM}/pulls/${pr.number}`, '--input', '-'], JSON.stringify(text));
    return notice(`updated ${pr.url} to ${NAME} ${to.version}`);
  }

  gh(['api', '-X', 'POST', `repos/${FORK}/merge-upstream`, '-f', 'branch=main']);
  const base = headSha(FORK, 'main');
  const fresh = findEntry(raw(FORK, base));
  if (!fresh) throw new Error(`${FORK} main has no ${NAME} entry after the sync`);
  if (compareVersions(to.version, fresh.version) <= 0) return notice(`${UPSTREAM} main already lists ${fresh.version}; nothing to do`);
  let exists = true;
  try {
    headSha(FORK, BUMP_BRANCH);
  } catch (e) {
    if (!e.notFound) throw e;
    exists = false;
  }
  if (exists) {
    gh(['api', '-X', 'PATCH', `repos/${FORK}/git/refs/heads/${BUMP_BRANCH}`, '--input', '-'], JSON.stringify({ sha: base, force: true }));
  } else {
    gh(['api', '-X', 'POST', `repos/${FORK}/git/refs`, '--input', '-'], JSON.stringify({ ref: `refs/heads/${BUMP_BRANCH}`, sha: base }));
  }
  commitFile(BUMP_BRANCH, to);
  const created = ghJson(
    ['api', '-X', 'POST', `repos/${UPSTREAM}/pulls`, '--input', '-'],
    JSON.stringify({ ...bumpText(fresh, to), head: `${OWNER}:${BUMP_BRANCH}`, base: 'main', maintainer_can_modify: true }),
  );
  notice(`opened ${created.html_url}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(inActions ? `::error::${e.message}` : e.message);
    process.exit(1);
  }
}
