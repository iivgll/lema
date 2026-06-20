import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULTS } from "../src/config.js";

describe("loadConfig", () => {
  test("returns defaults when no config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "lema-cfg-"));
    try {
      const cfg = loadConfig(dir);
      assert.equal(cfg.baseUrl, DEFAULTS.baseUrl);
      assert.equal(cfg.maxSteps, DEFAULTS.maxSteps);
      assert.equal(cfg.stateDir, DEFAULTS.stateDir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("merges lema.config.json over defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "lema-cfg-"));
    try {
      writeFileSync(join(dir, "lema.config.json"), JSON.stringify({ maxSteps: 5, temperature: 0.5 }));
      const cfg = loadConfig(dir);
      assert.equal(cfg.maxSteps, 5);
      assert.equal(cfg.temperature, 0.5);
      assert.equal(cfg.baseUrl, DEFAULTS.baseUrl); // unset fields stay default
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws on malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "lema-cfg-"));
    try {
      writeFileSync(join(dir, "lema.config.json"), "{ bad json }");
      assert.throws(() => loadConfig(dir), /Failed to parse/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("LEMA_MODEL env overrides model", () => {
    const dir = mkdtempSync(join(tmpdir(), "lema-cfg-"));
    const prev = process.env.LEMA_MODEL;
    try {
      process.env.LEMA_MODEL = "test-model";
      const cfg = loadConfig(dir);
      assert.equal(cfg.model, "test-model");
    } finally {
      if (prev === undefined) delete process.env.LEMA_MODEL;
      else process.env.LEMA_MODEL = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
