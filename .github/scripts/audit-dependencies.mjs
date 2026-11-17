import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const [toolDirectory, outputDirectory, phase] = process.argv.slice(2);
assert.ok(toolDirectory && outputDirectory && ["baseline", "candidate"].includes(phase));
const require = createRequire(join(toolDirectory, "package.json"));
const frozenLock = await readFile("yarn.lock");
const parsed = require("@yarnpkg/lockfile").parse(frozenLock.toString("utf8"));
assert.equal(parsed.type, "success");
const versions = new Map();
for (const [descriptor, value] of Object.entries(parsed.object)) {
  const name = descriptor.slice(0, descriptor.indexOf("@", descriptor.startsWith("@") ? 1 : 0));
  if (!versions.has(name)) versions.set(name, new Set());
  versions.get(name).add(value.version);
}

const npmCli = process.platform === "win32"
  ? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
  : await realpath(join(dirname(process.execPath), "npm"));
const npmRequire = createRequire(join(dirname(npmCli), "../package.json"));
const Arborist = npmRequire("@npmcli/arborist");
const { checkPlatform } = npmRequire("npm-install-checks");
const run = promisify(execFile);
for (const filename of ["package-lock.json", "npm-shrinkwrap.json"]) {
  await assert.rejects(readFile(filename), { code: "ENOENT" }, "Audit requires a fresh Yarn installation without an npm lockfile");
}
console.log("Writing an audit shrinkwrap from the installed frozen Yarn graph.");
try {
  await run(process.execPath, [npmCli, "shrinkwrap", "--ignore-scripts"], { maxBuffer: 8 * 1024 * 1024 });
} finally {
  await writeFile("yarn.lock", frozenLock);
}
let peerReport;
try {
  const { stdout } = await run(process.execPath, [npmCli, "ls", "--all", "--package-lock-only", "--json"], { maxBuffer: 8 * 1024 * 1024 });
  peerReport = JSON.parse(stdout);
} catch (error) {
  if (error.code !== 1) throw error;
  peerReport = JSON.parse(error.stdout);
  assert.equal(peerReport.error?.code, "ELSPROBLEMS");
}
await writeFile(join(outputDirectory, "peer-check.json"), JSON.stringify({ problems: peerReport.problems ?? [], error: peerReport.error }, null, 2));
const tree = await new Arborist({ path: process.cwd() }).loadActual();
const peerAdditions = [];
const platformExcluded = [];
const baselineBindings = [];
let matched = 0;
for (const node of tree.inventory.values()) {
  if (node.isRoot) continue;
  try {
    checkPlatform(node.package);
  } catch (error) {
    if (error.code !== "EBADPLATFORM") throw error;
    platformExcluded.push({ name: node.name, version: node.version });
    continue;
  }
  if (node.peer && !versions.has(node.name)) {
    peerAdditions.push({ name: node.name, version: node.version });
    continue;
  }
  // The historical lock lists Windows bindings, while locked Next pins other bindings exactly.
  if (phase === "baseline" && !versions.has(node.name) && node.optional && node.edgesIn.size > 0 && [...node.edgesIn].every((edge) => edge.optional && edge.spec === node.version && versions.get(edge.from.name)?.has(edge.from.version))) {
    baselineBindings.push({ name: node.name, version: node.version });
    continue;
  }
  assert.ok(versions.get(node.name)?.has(node.version), `${node.name}@${node.version} differs from the frozen Yarn graph`);
  matched++;
}
const auditLock = JSON.parse(await readFile("npm-shrinkwrap.json", "utf8"));
let auditMatched = 0;
for (const [location, entry] of Object.entries(auditLock.packages)) {
  if (!location) continue;
  const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
  try {
    checkPlatform(entry);
  } catch (error) {
    if (error.code !== "EBADPLATFORM") throw error;
    continue;
  }
  if (entry.peer && !versions.has(name)) continue;
  if (baselineBindings.some((binding) => binding.name === name && binding.version === entry.version)) continue;
  assert.ok(versions.get(name)?.has(entry.version), `${name}@${entry.version} in the audit differs from the frozen Yarn graph`);
  auditMatched++;
}
await writeFile(join(outputDirectory, "audit-graph.json"), JSON.stringify({ matched, auditMatched, peerAdditions, platformExcluded, baselineBindings }, null, 2));

let stdout;
try {
  ({ stdout } = await run(process.execPath, [npmCli, "audit", "--json"], { maxBuffer: 8 * 1024 * 1024 }));
} catch (error) {
  if (error.code !== 1) throw error;
  stdout = error.stdout;
}
const audit = JSON.parse(stdout);
assert.ok(audit.metadata?.vulnerabilities, "The registry did not return an audit report");
await writeFile(join(outputDirectory, "audit.json"), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ phase, vulnerabilities: audit.metadata.vulnerabilities }));
if (phase === "candidate") assert.equal(audit.metadata.vulnerabilities.total, 0, "Candidate dependencies have reported vulnerabilities");
assert.equal(peerReport.problems?.length ?? 0, 0, "The frozen dependency graph has peer problems; see peer-check.json");
