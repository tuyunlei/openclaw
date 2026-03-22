import { afterEach, describe, expect, it } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { OpenClawConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";

function createTestPlugin(params: { allowFrom?: Array<string | number> }): ChannelPlugin {
  return {
    id: "testchan" as ChannelPlugin["id"],
    meta: {
      id: "testchan",
      label: "Test Channel",
      selectionLabel: "Test Channel",
      docsPath: "/channels/testchan",
      blurb: "test stub.",
    },
    capabilities: { chatTypes: ["direct"] },
    config: {
      listAccountIds: () => ["default"],
      resolveAccount: () => ({}),
      resolveAllowFrom: () => params.allowFrom,
      formatAllowFrom: ({ allowFrom }: { allowFrom: Array<string | number> }) =>
        allowFrom.map((entry: string | number) => String(entry).trim()).filter(Boolean),
    },
  } as unknown as ChannelPlugin;
}

function makeRegistry(channels: Array<{ pluginId: string; plugin: unknown; source: string }>) {
  return createTestRegistry(channels);
}

  afterEach(() => {
    setActivePluginRegistry(makeRegistry([]));
  });

  it("returns owner list when channel has allowFrom configured", () => {
    const plugin = createTestPlugin({ allowFrom: ["+15550001", "+15550002"] });
    setActivePluginRegistry(makeRegistry([{ pluginId: "testchan", plugin, source: "test" }]));
    const cfg = {} as OpenClawConfig;
      cfg,
      messageChannel: "testchan",
    });
    expect(result).toEqual(["+15550001", "+15550002"]);
  });

  it("returns undefined when channel has no allowFrom", () => {
    const plugin = createTestPlugin({ allowFrom: undefined });
    setActivePluginRegistry(makeRegistry([{ pluginId: "testchan", plugin, source: "test" }]));
    const cfg = {} as OpenClawConfig;
      cfg,
      messageChannel: "testchan",
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when messageChannel is undefined", () => {
    setActivePluginRegistry(makeRegistry([]));
    const cfg = {} as OpenClawConfig;
      cfg,
      messageChannel: undefined,
    });
    expect(result).toBeUndefined();
  });

  it("uses explicit ownerAllowFrom from config over channel allowFrom", () => {
    const plugin = createTestPlugin({ allowFrom: ["+15550001"] });
    setActivePluginRegistry(makeRegistry([{ pluginId: "testchan", plugin, source: "test" }]));
    const cfg = {
      commands: { ownerAllowFrom: ["+15559999"] },
    } as OpenClawConfig;
      cfg,
      messageChannel: "testchan",
    });
    expect(result).toEqual(["+15559999"]);
  });

  it("returns undefined when ownerAllowFrom is wildcard", () => {
    const plugin = createTestPlugin({ allowFrom: ["+15550001"] });
    setActivePluginRegistry(makeRegistry([{ pluginId: "testchan", plugin, source: "test" }]));
    const cfg = {
      commands: { ownerAllowFrom: ["*"] },
    } as OpenClawConfig;
      cfg,
      messageChannel: "testchan",
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when channel allowFrom is wildcard", () => {
    const plugin = createTestPlugin({ allowFrom: ["*"] });
    setActivePluginRegistry(makeRegistry([{ pluginId: "testchan", plugin, source: "test" }]));
    const cfg = {} as OpenClawConfig;
      cfg,
      messageChannel: "testchan",
    });
    expect(result).toBeUndefined();
  });
});
