import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, listDir, bash } from "../src/tools/index.js";

let cwd: string;
before(() => { cwd = mkdtempSync(join(tmpdir(), "lema-tools-")); });
after(() => { rmSync(cwd, { recursive: true, force: true }); });

const ctx = () => ({ cwd });

describe("readFile", () => {
  test("reads an existing file", async () => {
    writeFileSync(join(cwd, "hello.txt"), "world");
    const result = await readFile.run({ path: "hello.txt" }, ctx());
    assert.equal(result, "world");
  });

  test("returns error for missing file", async () => {
    const result = await readFile.run({ path: "no-such.txt" }, ctx());
    assert.match(result, /ERROR/);
  });

  test("rejects path escaping cwd", async () => {
    await assert.rejects(() => readFile.run({ path: "../../etc/passwd" }, ctx()));
  });
});

describe("writeFile", () => {
  test("creates a new file", async () => {
    const result = await writeFile.run({ path: "new.txt", content: "data" }, ctx());
    assert.match(result, /OK/);
    const read = await readFile.run({ path: "new.txt" }, ctx());
    assert.equal(read, "data");
  });

  test("overwrites existing file", async () => {
    await writeFile.run({ path: "over.txt", content: "v1" }, ctx());
    await writeFile.run({ path: "over.txt", content: "v2" }, ctx());
    assert.equal(await readFile.run({ path: "over.txt" }, ctx()), "v2");
  });

  test("creates nested directories", async () => {
    const result = await writeFile.run({ path: "a/b/c.txt", content: "deep" }, ctx());
    assert.match(result, /OK/);
    assert.equal(await readFile.run({ path: "a/b/c.txt" }, ctx()), "deep");
  });
});

describe("listDir", () => {
  test("lists files in directory", async () => {
    const dir = join(cwd, "mydir");
    mkdirSync(dir);
    writeFileSync(join(dir, "file.txt"), "");
    const result = await listDir.run({ path: "mydir" }, ctx());
    assert.match(result, /file\.txt/);
  });

  test("marks subdirectories with /", async () => {
    const result = await listDir.run({ path: "." }, ctx());
    assert.match(result, /mydir\//);
  });

  test("returns error for missing directory", async () => {
    const result = await listDir.run({ path: "nonexistent" }, ctx());
    assert.match(result, /ERROR/);
  });
});

describe("bash", () => {
  test("runs a command and returns stdout", async () => {
    const result = await bash.run({ command: "echo hello" }, ctx());
    assert.equal(result.trim(), "hello");
  });

  test("captures stderr in output", async () => {
    const result = await bash.run({ command: "echo err >&2" }, ctx());
    assert.match(result, /err/);
  });

  test("returns exit code on failure", async () => {
    const result = await bash.run({ command: "exit 1" }, ctx());
    assert.match(result, /EXIT 1/);
  });

  test("runs in the working directory", async () => {
    await writeFile.run({ path: "check.txt", content: "" }, ctx());
    const result = await bash.run({ command: "ls check.txt" }, ctx());
    assert.match(result, /check\.txt/);
  });
});
