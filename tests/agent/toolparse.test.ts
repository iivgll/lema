import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseTextToolCalls, stripToolMarkup } from "../../src/agent/toolparse.js";

describe("parseTextToolCalls", () => {
  test("parses the XML function/parameter form", () => {
    const text = "<tool_call><function=read_file><parameter=path>src/models/base.ts</parameter></function></tool_call>";
    const [call] = parseTextToolCalls(text);
    assert.equal(call.function.name, "read_file");
    assert.deepEqual(JSON.parse(call.function.arguments), { path: "src/models/base.ts" });
  });

  test("parses bare function blocks without a tool_call wrapper", () => {
    const text = "<function=grep><parameter=pattern>TODO</parameter></function>";
    const [call] = parseTextToolCalls(text);
    assert.equal(call.function.name, "grep");
    assert.deepEqual(JSON.parse(call.function.arguments), { pattern: "TODO" });
  });

  test("parses the Hermes JSON form", () => {
    const text = '<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>';
    const [call] = parseTextToolCalls(text);
    assert.equal(call.function.name, "read_file");
    assert.deepEqual(JSON.parse(call.function.arguments), { path: "a.ts" });
  });

  test("handles multiple parameters", () => {
    const text = "<function=edit_file><parameter=path>x.ts</parameter><parameter=old>a</parameter><parameter=new>b</parameter></function>";
    const [call] = parseTextToolCalls(text);
    assert.deepEqual(JSON.parse(call.function.arguments), { path: "x.ts", old: "a", new: "b" });
  });

  test("assigns ids to recovered calls", () => {
    const text = "<function=glob><parameter=pattern>*.ts</parameter></function>";
    const [call] = parseTextToolCalls(text);
    assert.ok(call.id);
  });

  test("returns [] for plain prose", () => {
    assert.deepEqual(parseTextToolCalls("This project is a local CLI tool."), []);
  });

  test("returns [] for empty string", () => {
    assert.deepEqual(parseTextToolCalls(""), []);
  });
});

describe("stripToolMarkup", () => {
  test("removes <tool_call> blocks", () => {
    const r = stripToolMarkup('Done.\n<tool_call>{"name":"bash"}</tool_call>');
    assert.equal(r, "Done.");
  });

  test("removes <function=…> blocks", () => {
    const r = stripToolMarkup("ok\n<function=bash><parameter=command>npm test</parameter></function>");
    assert.equal(r, "ok");
  });

  test("leaves plain prose untouched", () => {
    assert.equal(stripToolMarkup("just an answer"), "just an answer");
  });
});
