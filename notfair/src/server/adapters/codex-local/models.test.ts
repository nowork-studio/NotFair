import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { listCodexModels } from "./models";

async function fixture(config: string, models: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), "notfair-codex-models-"));
  const configFile = join(dir, "config.toml");
  const cacheFile = join(dir, "models_cache.json");
  await Promise.all([
    writeFile(configFile, config, "utf8"),
    writeFile(cacheFile, JSON.stringify({ models }), "utf8"),
  ]);
  return { configFile, cacheFile };
}

describe("listCodexModels", () => {
  it("marks the root configured model as the concrete no-override model", async () => {
    const files = await fixture(
      'model = "gpt-5.6-sol"\n\n[profiles.fast]\nmodel = "gpt-5.4"\n',
      [
        { slug: "gpt-5.4", display_name: "GPT-5.4", priority: 1 },
        { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", priority: 2 },
      ],
    );

    const models = await listCodexModels(files.cacheFile, files.configFile);

    expect(models.find((model) => model.is_default)).toMatchObject({
      value: "gpt-5.6-sol",
      label: "GPT-5.6-Sol",
    });
  });

  it("keeps a configured model visible when the provider cache is stale", async () => {
    const files = await fixture('model = "gpt-custom"\n', [
      { slug: "gpt-5.4", display_name: "GPT-5.4", priority: 1 },
    ]);

    const models = await listCodexModels(files.cacheFile, files.configFile);

    expect(models[0]).toEqual({
      value: "gpt-custom",
      label: "gpt-custom",
      is_default: true,
    });
  });
});
