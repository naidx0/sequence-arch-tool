/**
 * Per-platform binaries for the agents in the built-in catalog that ship as an archive, copied from the
 * ACP registry (v1.0.0, read 2026-10-16) with their sha256. An install downloads the archive for this
 * machine, checks the hash, and only then unpacks it (agentBinaryInstall.ts). A Refresh replaces these
 * with the live registry's.
 */

import type { RegistryBinary } from './agentCatalog.js';

export const SNAPSHOT_BINARIES: Record<string, { version: string; binary: Record<string, RegistryBinary> }> = {
  opencode: {
    version: "1.19.1",
    binary: {
      "darwin-aarch64": {
        archive: "https://github.com/anomalyco/opencode/releases/download/v1.19.1/opencode-darwin-arm64.zip",
        cmd: "./opencode",
        args: [
          "acp"
        ],
        sha256: "c9c4b7833a2cb0a0b676031d8b688012b5025bc55a890e2acd4412cb04d19b02"
      },
      "darwin-x86_64": {
        archive: "https://github.com/anomalyco/opencode/releases/download/v1.19.1/opencode-darwin-x64.zip",
        cmd: "./opencode",
        args: [
          "acp"
        ],
        sha256: "2c446f5d482cb78f7d8ea3f276b3feda38a64346d574e56a744111dee52813e3"
      },
      "linux-aarch64": {
        archive: "https://github.com/anomalyco/opencode/releases/download/v1.19.1/opencode-linux-arm64.tar.gz",
        cmd: "./opencode",
        args: [
          "acp"
        ],
        sha256: "3840e9afb2462a666d31816b20bc13b91af9845c329cff660a972aa9cfaee3a2"
      },
      "linux-x86_64": {
        archive: "https://github.com/anomalyco/opencode/releases/download/v1.19.1/opencode-linux-x64.tar.gz",
        cmd: "./opencode",
        args: [
          "acp"
        ],
        sha256: "6f1904b860bdbd32e90e679c9e1b0e64e78269a353e1497d5ea792dfa449538c"
      },
      "windows-aarch64": {
        archive: "https://github.com/anomalyco/opencode/releases/download/v1.19.1/opencode-windows-arm64.zip",
        cmd: "./opencode",
        args: [
          "acp"
        ],
        sha256: "66fe17e0affa121f84191565c443cfdee35d1af5399b8470e70b8c4a00f6a291"
      },
      "windows-x86_64": {
        archive: "https://github.com/anomalyco/opencode/releases/download/v1.19.1/opencode-windows-x64.zip",
        cmd: "./opencode.exe",
        args: [
          "acp"
        ],
        sha256: "efcbef1dc5265f468f43e607ea3c5729026e0a0a4e8f1d7552e97ac3acd3c7f4"
      }
    }
  },
  goose: {
    version: "1.54.0",
    binary: {
      "darwin-aarch64": {
        archive: "https://github.com/block/goose/releases/download/v1.54.0/goose-aarch64-apple-darwin.tar.bz2",
        cmd: "./goose",
        args: [
          "acp"
        ],
        sha256: "63738f0eed2fe9d8585a4ba988c3ffb23d600db0b43858a6cd868fa6b035a7af"
      },
      "darwin-x86_64": {
        archive: "https://github.com/block/goose/releases/download/v1.54.0/goose-x86_64-apple-darwin.tar.bz2",
        cmd: "./goose",
        args: [
          "acp"
        ],
        sha256: "81fd55f4003950bb72719402e2defb1375eef4b9a739d901a365fb737b73aeee"
      },
      "linux-aarch64": {
        archive: "https://github.com/block/goose/releases/download/v1.54.0/goose-aarch64-unknown-linux-gnu.tar.bz2",
        cmd: "./goose",
        args: [
          "acp"
        ],
        sha256: "8c7ad233bdaf05f10a52ef36f3ce50f839cb1d2d1df5b31b172af7150c1c288e"
      },
      "linux-x86_64": {
        archive: "https://github.com/block/goose/releases/download/v1.54.0/goose-x86_64-unknown-linux-gnu.tar.bz2",
        cmd: "./goose",
        args: [
          "acp"
        ],
        sha256: "bf01cb6359f7a2b1acb54ca4827e1d059b18aabb3d2b75202e21066cfd3a3396"
      },
      "windows-x86_64": {
        archive: "https://github.com/block/goose/releases/download/v1.54.0/goose-x86_64-pc-windows-msvc.zip",
        cmd: "./goose-package\\goose.exe",
        args: [
          "acp"
        ],
        sha256: "5c39bc91c3eadc231847e21a8a469e778431084437b233a63a950fee22db6239"
      }
    }
  },
  kimi: {
    version: "1.52.0",
    binary: {
      "darwin-aarch64": {
        archive: "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-aarch64-apple-darwin.tar.gz",
        cmd: "./kimi",
        args: [
          "acp"
        ],
        sha256: "43fe091f70bbf8860974200f9021a05689a020857cc9926d56f1505f0d0d5cb8"
      },
      "linux-aarch64": {
        archive: "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-aarch64-unknown-linux-gnu.tar.gz",
        cmd: "./kimi",
        args: [
          "acp"
        ],
        sha256: "9e06eea96273600aed485b1f0bedda95b7084db4f22cf28614fe20138933507a"
      },
      "linux-x86_64": {
        archive: "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-x86_64-unknown-linux-gnu.tar.gz",
        cmd: "./kimi",
        args: [
          "acp"
        ],
        sha256: "a676204f7804ed5dae87652a9d66f578e0718d5026c9cb1bfa32b9a5eace4208"
      },
      "windows-aarch64": {
        archive: "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-aarch64-pc-windows-msvc.zip",
        cmd: "./kimi.exe",
        args: [
          "acp"
        ],
        sha256: "7c77cd413e7a3a59416c171a45ee4ff50534869b331469138aad84b9e3acb6c0"
      },
      "windows-x86_64": {
        archive: "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-x86_64-pc-windows-msvc.zip",
        cmd: "./kimi.exe",
        args: [
          "acp"
        ],
        sha256: "2c269e15e152b9f28ac1556795280f90a2c9860ff44c60c628c3fce4dd4c58a7"
      }
    }
  },
  "mistral-vibe": {
    version: "2.26.1",
    binary: {
      "darwin-aarch64": {
        archive: "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-darwin-aarch64-2.26.1.tar.gz",
        cmd: "./vibe-acp",
        args: [],
        sha256: "4035a97f3bf99d91589ae4b5399438fb417f6b72511a995c7c363ec4b468f10a"
      },
      "darwin-x86_64": {
        archive: "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-darwin-x86_64-2.26.1.tar.gz",
        cmd: "./vibe-acp",
        args: [],
        sha256: "3acfc454ffc248826a05333e1cb2467c465308639bbba6725b47384dc9e8f757"
      },
      "linux-aarch64": {
        archive: "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-linux-aarch64-2.26.1.tar.gz",
        cmd: "./vibe-acp",
        args: [],
        sha256: "147ce53d0d185148ac269e23ff285eb087167077ba00d7c9ff41492c647ad2c6"
      },
      "linux-x86_64": {
        archive: "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-linux-x86_64-2.26.1.tar.gz",
        cmd: "./vibe-acp",
        args: [],
        sha256: "c8a018ca7d02eed5cebf291f6bcce1744e44323ff774b1c3fceac13794a95634"
      },
      "windows-x86_64": {
        archive: "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-windows-x86_64-2.26.1.zip",
        cmd: "./vibe-acp.exe",
        args: [],
        sha256: "fd192698e396470f478adda5ce57cd8fd58927a2cd5e35ec1055c7c55089d370"
      }
    }
  }
};
