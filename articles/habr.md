# Harness важнее модели: как мы заставили 9B обгонять 30B

Есть расхожее мнение что качество локального LLM-агента определяется качеством модели. Больше параметров — лучше результат. Отчасти это правда. Но есть нюанс: при одинаковом harness'е это работает. При разных harness'ах — нет.

Я провёл несколько недель экспериментируя с этим и в итоге написал **lema** — опенсорсный агентный CLI для локальных LLM. В этой статье расскажу что нашёл и как устроен инструмент изнутри.

---

## Проблема, которую я пытался решить

Типичный сценарий провала локального агента:

```
Задача: "исправь падающие тесты в репозитории"

1. Модель читает тест-файл ✓
2. Модель читает исходный код ✓  
3. Модель генерирует фикс ✓
4. Модель не запускает тесты ✗
5. Модель возвращает уверенный неправильный ответ ✗
```

Модель знала как исправить. Она просто не имела механизма проверить своё решение. И не имела памяти о том, что работало в прошлый раз.

Это не проблема модели — это проблема harness'а.

---

## Архитектура

```
src/
  agent/       — основной цикл: инструменты, верификация, память
  models/      — OpenAI-совместимый провайдер (LM Studio, Ollama, llama.cpp)
  context/     — управление окном контекста + компакция
  memory/      — file-backed хранилище с embedding-поиском
  skills/      — библиотека авторских скилов
  tools/       — read, write, edit, grep, glob, bash, web
  mcp/         — MCP-сервер для программного управления
  tui/         — alt-screen TUI интерфейс
```

Zero runtime зависимостей — только Node stdlib и нативный `fetch`.

---

## Цикл верификации

Главная идея — модель не должна проверять своё решение в голове. Она должна запускать реальную команду.

```typescript
// Упрощённо из src/agent/index.ts
while (steps < hardCap) {
  const reply = await provider.chat(ctx.render(), { tools, model });
  
  if (!reply.tool_calls?.length) {
    // Модель закончила — запускаем проверку
    const check = await verifier?.run();
    
    if (check && !check.ok) {
      // Тесты упали — кормим вывод обратно
      ctx.push({ role: "system", content: `Check failed:\n${check.output}\n\nFix it.` });
      continue; // следующая итерация
    }
    
    // Тесты прошли — записываем урок в память
    if (wentRedThenGreen) await recordLesson(memory, task, command);
    return { answer: reply.content, steps };
  }
  
  // Выполняем тулзы
  for (const call of reply.tool_calls) {
    const result = await runTool(call);
    ctx.push(toolResult(result));
  }
}
```

Модель не говорит "кажется исправил" — она либо прошла проверку, либо нет.

---

## Управление контекстом

Длинные задачи переполняют контекстное окно. Большинство агентов просто деградируют или крашатся. 

lema автоматически компактит когда давление превышает порог:

```typescript
const COMPACT_AT = 0.82; // 82% заполнения

if (ctx.pressure() >= COMPACT_AT) {
  await ctx.compact(makeSummarizer(provider, model));
  emit({ type: "step", label: "compact", text: "context full — compacted" });
}
```

`makeSummarizer` просит модель написать краткое резюме разговора, заменяет старые сообщения этим резюме, и продолжает. 20-шаговые задачи на 9B модели без деградации.

---

## Память

Embedding-based хранилище уроков. Когда задача завершилась циклом провал→успех:

```typescript
await memory.save({
  name: `lesson: ${task.slice(0, 48)}`,
  description: `Working on "${task}", \`${command}\` failed first`,
  kind: "lesson",
  body: `Always run \`${command}\` to verify. Prior failure:\n${failureOutput}`,
});
```

На следующей похожей задаче:

```typescript
const relevant = await memory.search(task, 3); // cosine similarity
if (relevant.length) {
  ctx.push({ role: "system", content: `Recalled memory:\n${format(relevant)}` });
}
```

Модель читает уроки прошлого перед началом. DRY-принцип на уровне агентских сессий.

---

## Интересный баг: reasoning_content

При тестировании qwen3.5-9b наткнулся на неожиданное: модель возвращала пустой ответ при явно ненулевом completion token count.

Диагностика через прямой вызов API:

```bash
curl http://localhost:1234/v1/chat/completions \
  -d '{"model":"qwen/qwen3.5-9b","messages":[{"role":"user","content":"Say hello"}]}'
```

```json
{
  "role": "assistant", 
  "content": "",
  "reasoning_content": "Thinking Process:\n1. Analyze the Request..."
}
```

LM Studio с thinking-моделями возвращает `content: ""` и кладёт всё мышление в `reasoning_content`. Наш тип `ChatMessage` это поле не знал, оно просто дропалось при кастинге.

Фикс в двух местах:

```typescript
// src/models/message.ts
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning_content?: string; // добавили
  tool_calls?: ToolCall[];
}

// src/agent/index.ts — при пустом content просим финальный ответ явно
const rawContent = reply.content?.trim() ?? "";
if (!rawContent && reply.reasoning_content) {
  const answer = await forceFinish(provider, ctx, model, "Write your final answer now.");
  return { answer, steps };
}
```

И `reasoning_content` не пушим в контекст — иначе thinking-токены начнут накапливаться в истории и жрать окно.

---

## Сравнение моделей

Тестировал на одинаковых задачах (pomodoro-таймер на Python, ~4 файла):

| Модель | Квант | Шагов на задачу | Точность | tok/s |
|--------|-------|-----------------|----------|-------|
| qwen3-coder-30B | iq2_xxs | 20-26 | средняя | 8-15 |
| qwen3.5-9B | 8-bit | 2-4 | высокая | 11-13 |

30B технически умнее, но агрессивный квант убивает качество рассуждений. 9B с нормальным квантом читает файл, делает правку, проверяет — готово. 30B ходит по кругу, повторяет вызовы тулзов, теряет нить.

Вывод: качество кванта важнее размера модели, когда harness правильный.

---

## MCP-сервер

Для программного управления lema реализует MCP (Model Context Protocol) — JSON-RPC 2.0 по stdio:

```bash
# В ~/.claude/settings.json
{
  "mcpServers": {
    "lema": {
      "command": "node",
      "args": ["/path/to/dist/mcp/index.js"],
      "env": { "LEMA_CWD": "/your/project" }
    }
  }
}
```

Доступные инструменты: `lema_run`, `lema_abort`, `lema_stats`, `lema_context`, `lema_models`, `lema_set_model`, `lema_set_effort`, `lema_compact`, `lema_memory_search`.

Это позволяет Claude Code (или любому MCP-клиенту) контролировать lema — запускать задачи, следить за событиями, инспектировать контекст.

---

## Что реально работает сейчас

- LM Studio + qwen3.5-9b (8-bit) — primary tested setup
- Одиночные задачи с явным критерием готовности (`npm test`, `pytest`, `cargo test`)
- Фиксы багов, написание тестов, небольшие рефакторинги
- Задачи до ~20 шагов до начала давления на контекст

Что не работает хорошо: большие кодовые базы (500+ файлов), задачи без чёткого verifier, всё что требует глобального понимания проекта.

---

## Попробовать

```bash
npm install -g @iivgll4/lema
lema ping   # проверить LM Studio
lema "add input validation and write tests for it"
```

GitHub: [iivgll/lema](https://github.com/iivgll/lema) · MIT · TypeScript · zero runtime deps
