import type { SDKConfig } from "./src/types.js";

const sdks = {
  cli: {
    displayName: "CLI",
    versionLabel: "CLI",
    icon: "terminal",
    order: 7,
    repo: "https://github.com/e2b-dev/e2b.git",
    tagPattern: "@e2b/cli@",
    tagFormat: "@e2b/cli@{version}",
    sdkPath: "packages/cli",
    generator: "cli",
    required: true,
    minVersion: "1.0.0",
  },

  "js-sdk": {
    displayName: "SDK (JavaScript)",
    versionLabel: "JS",
    icon: "square-js",
    order: 1,
    repo: "https://github.com/e2b-dev/e2b.git",
    tagPattern: "e2b@",
    tagFormat: "e2b@{version}",
    sdkPath: "packages/js-sdk",
    generator: "typedoc",
    required: true,
    minVersion: "1.0.0",

    defaultConfig: {
      entryPoints: [
        "src/sandbox/index.ts",
        "src/sandbox/filesystem/index.ts",
        "src/sandbox/process/index.ts",
        "src/sandbox/commands/index.ts",
        "src/errors.ts",
        "src/template/index.ts",
        "src/template/readycmd.ts",
        "src/template/logger.ts",
        "src/volume/index.ts",
      ],
    },

    configOverrides: {
      "1.0.0": {
        entryPoints: [
          "src/sandbox/index.ts",
          "src/sandbox/filesystem/index.ts",
          "src/sandbox/process/index.ts",
          "src/sandbox/pty.ts",
          "src/errors.ts",
        ],
      },

      ">=1.1.0 <2.3.0": {
        entryPoints: [
          "src/sandbox/index.ts",
          "src/sandbox/filesystem/index.ts",
          "src/sandbox/process/index.ts",
          "src/sandbox/commands/index.ts",
          "src/errors.ts",
        ],
      },

      ">=2.3.0 <2.18.0": {
        entryPoints: [
          "src/sandbox/index.ts",
          "src/sandbox/filesystem/index.ts",
          "src/sandbox/process/index.ts",
          "src/sandbox/commands/index.ts",
          "src/errors.ts",
          "src/template/index.ts",
          "src/template/readycmd.ts",
          "src/template/logger.ts",
        ],
      },
    },
  },

  "python-sdk": {
    displayName: "SDK (Python)",
    versionLabel: "Python",
    icon: "python",
    order: 2,
    repo: "https://github.com/e2b-dev/e2b.git",
    tagPattern: "@e2b/python-sdk@",
    tagFormat: "@e2b/python-sdk@{version}",
    sdkPath: "packages/python-sdk",
    generator: "pydoc",
    required: true,
    minVersion: "1.0.0",

    defaultConfig: {
      allowedPackages: [
        "e2b.sandbox_sync",
        "e2b.sandbox_async",
        "e2b.exceptions",
        "e2b.template",
        "e2b.template_sync",
        "e2b.template_async",
        "e2b.template.logger",
        "e2b.template.readycmd",
        "e2b.volume.volume_sync",
        "e2b.volume.volume_async",
      ],
    },

    configOverrides: {
      ">=1.0.0 <2.1.0": {
        allowedPackages: [
          "e2b.sandbox_sync",
          "e2b.sandbox_async",
          "e2b.exceptions",
        ],
      },

      ">=2.1.0 <2.19.0": {
        allowedPackages: [
          "e2b.sandbox_sync",
          "e2b.sandbox_async",
          "e2b.exceptions",
          "e2b.template",
          "e2b.template_sync",
          "e2b.template_async",
          "e2b.template.logger",
          "e2b.template.readycmd",
        ],
      },
    },
  },

  "code-interpreter-js-sdk": {
    displayName: "Code Interpreter SDK (JavaScript)",
    versionLabel: "Code Interpreter JS",
    icon: "square-js",
    order: 3,
    repo: "https://github.com/e2b-dev/code-interpreter.git",
    tagPattern: "@e2b/code-interpreter@",
    tagFormat: "@e2b/code-interpreter@{version}",
    sdkPaths: ["js"],
    generator: "typedoc",
    required: false,
    minVersion: "1.0.0",

    defaultConfig: {
      entryPoints: [
        "src/index.ts",
        "src/charts.ts",
        "src/consts.ts",
        "src/messaging.ts",
        "src/sandbox.ts",
      ],
    },
  },

  "code-interpreter-python-sdk": {
    displayName: "Code Interpreter SDK (Python)",
    versionLabel: "Code Interpreter Python",
    icon: "python",
    order: 4,
    repo: "https://github.com/e2b-dev/code-interpreter.git",
    tagPattern: "@e2b/code-interpreter-python@",
    tagFormat: "@e2b/code-interpreter-python@{version}",
    sdkPaths: ["python"],
    generator: "pydoc",
    required: false,
    minVersion: "1.0.0",

    defaultConfig: {
      allowedPackages: ["e2b_code_interpreter"],
    },
  },

  "desktop-js-sdk": {
    displayName: "Desktop SDK (JavaScript)",
    versionLabel: "Desktop JS",
    icon: "square-js",
    order: 5,
    repo: "https://github.com/e2b-dev/desktop.git",
    tagPattern: "@e2b/desktop@",
    tagFormat: "@e2b/desktop@{version}",
    sdkPaths: ["packages/js-sdk"],
    generator: "typedoc",
    required: false,
    minVersion: "1.0.0",

    defaultConfig: {
      entryPoints: ["src/index.ts", "src/sandbox.ts"],
    },
  },

  "desktop-python-sdk": {
    displayName: "Desktop SDK (Python)",
    versionLabel: "Desktop Python",
    icon: "python",
    order: 6,
    repo: "https://github.com/e2b-dev/desktop.git",
    tagPattern: "@e2b/desktop-python@",
    tagFormat: "@e2b/desktop-python@{version}",
    sdkPaths: ["packages/python-sdk"],
    generator: "pydoc",
    required: false,
    minVersion: "1.0.0",

    defaultConfig: {
      allowedPackages: ["e2b_desktop"],
    },
  },
} as const satisfies Record<string, SDKConfig>;

export default sdks;
