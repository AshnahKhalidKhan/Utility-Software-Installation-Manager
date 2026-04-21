# Utility Software Installation Manager

Windows desktop tool for technical teams to **install** or **uninstall** a curated set of build and troubleshooting software. The list is **data-driven** (`Data/catalog.json`) so you can pin versions, swap package IDs, or add PowerShell steps without recompiling.

## Giving end users a single `.exe` (no separate .NET install)

This app is built with **.NET and WPF**. Those **cannot** run with “only PowerShell/bash” unless you **ship the runtime with the app**. The standard approach is **not** to download .NET on first launch (that would need admin, a network installer, and fragile detection), but to publish a **self-contained** build so **everything required to open the UI** is **inside the file you distribute**.

1. On a machine with the **.NET 8 SDK**, run:

   ```powershell
   .\scripts\Publish-Standalone.ps1
   ```

2. Give users **`artifacts\InstallerManager-Standalone\InstallerManager.exe`** (about **60–80 MB** depending on compression). They **double-click to run** — **no** separate .NET Desktop Runtime, **no** extra files, **no** PowerShell needed **just to launch** the app.

3. The default catalog is **embedded** in that build. Optional: place `Data\catalog.json` next to the exe to override without rebuilding.

4. **First run** of a single-file exe may **extract** files to a cache under the user profile (normal .NET behavior). That is not a separate “dependency install”; it is the runtime already included in your download.

5. **Bash** does not apply on Windows for this app. **PowerShell** is only used if a catalog entry uses the PowerShell provider — not for starting the UI.

6. When users actually **install software** from the catalog, they still need **winget** (for winget rows), **elevation** where installers require it, and **network** — that is separate from “open the app.”

**Developers** building from source still need the **.NET 8 SDK**. **End users** who only receive the published self-contained **`.exe`** do not.

## Requirements

- Windows 10/11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (to build)
- [.NET 8 **Desktop** Runtime](https://dotnet.microsoft.com/download/dotnet/8.0) (only if you distribute a **framework-dependent** build without bundling the runtime — **not** needed for the self-contained `.exe` above)
- [winget](https://learn.microsoft.com/windows/package-manager/winget/) (App Installer / Microsoft Store) for most packages
- **Administrator** is required for most installs. The app uses **asInvoker** so `dotnet run` starts normally; use **Restart as administrator** in the yellow banner (or choose Yes when installing), which relaunches correctly for both **`dotnet run`** (`dotnet exec` + UAC) and **`InstallerManager.exe`**. You can also right-click the `.exe` → Run as administrator, or open an elevated terminal before `dotnet run`.

## Run from source

```powershell
cd src/InstallerManager.App
dotnet run
```

Or open `InstallerManager.sln` in Visual Studio and start the **InstallerManager** project.

## Reducing machine prerequisites

| Goal | Approach |
|------|----------|
| **No separate .NET install** | Publish **self-contained** (bundles the runtime with your app). Larger download, no Desktop Runtime prerequisite on the target PC. |
| **No loose `Data\catalog.json` file** | A default catalog is **embedded** in the assembly. If `Data\catalog.json` (or `catalog.json` next to the exe) exists, it **overrides** the embedded copy—useful for IT overrides without rebuilding. |
| **winget** | Still required **for winget-based catalog rows**, unless you change the catalog to download/run MSIs or use another mechanism. |
| **Administrator** | Still required for most **system-wide** installs; that is a Windows constraint, not specific to this app. |
| **Zero runtime at all** | Would mean **not** using .NET/WPF (e.g. native Win32, or a small bootstrapper). That is a full rewrite, not a publish switch. |

**Self-contained example** (single folder, no .NET prerequisite; catalog is embedded if you omit `Data\`):

```powershell
dotnet publish .\src\InstallerManager.App\InstallerManager.App.csproj -c Release -r win-x64 --self-contained true -o .\publish
```

Optional single-file (one main exe; first launch may extract to a cache):

```powershell
dotnet publish .\src\InstallerManager.App\InstallerManager.App.csproj -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o .\publish
```

## Customize the catalog

Edit `src/InstallerManager.App/Data/catalog.json` in source, or ship an override as `Data\catalog.json` next to the built `.exe` (overrides the embedded default).

- **Winget** entries use `wingetId` and optional `wingetVersion` (omit for “latest” per winget).
- **PowerShell** entries use `powershellInstall` / `powershellUninstall` (encoded for `powershell.exe`).
- **Composite** runs multiple **steps** in order (install) or reverse order (uninstall)—useful for chained prerequisites.

Validate IDs on a machine with:

`winget search <name>` and `winget show <id> --versions`

Some IDs (for example SQL Server edition, Claude desktop, PostgreSQL major line) vary by channel and region—adjust to match what `winget` exposes in your environment.

### Notes from your requirements

- **Multiple SQL Server versions/editions**: add one catalog item per edition, each with its own `wingetId` or custom installer strategy.
- **PostgreSQL + pgvector**: install PostgreSQL from the catalog, then enable the extension per database when your approved build supports it (`CREATE EXTENSION vector;`). If you use a non–winget build, replace the entry with **PowerShell** or **Composite** steps.
- **Python on Linux**: intentionally omitted for now; the same catalog schema can be reused later from a different host or a separate profile.
- **Google Chrome**: pinned in the catalog as `Google.Chrome`; use `wingetVersion` when you must match a tested build.

## Project layout

- `InstallerManager.sln` — solution
- `src/InstallerManager.App` — WPF UI, catalog models, winget/PowerShell orchestration

## Troubleshooting: “Run as administrator” / nothing happens / instant close

1. **Run the exe from the build output folder**  
   Prefer the full output folder. If `Data\catalog.json` is missing, the app **falls back to the embedded catalog** (so a lone `.exe` can still start after a self-contained publish). A **file** next to the exe always wins over the embedded default.

2. **Install .NET 8 Desktop Runtime**  
   If Windows shows a prompt to install .NET, or the app flashes and closes with no UI, install the **Desktop** runtime (x64) for .NET 8 from Microsoft. The SDK alone does not install the runtime on other PCs.

3. **OneDrive / synced Desktop**  
   Some policies block running elevated apps from synced folders, or files are “online-only.” Copy the whole **`net8.0-windows` output folder** (including `Data\`) to a local path such as `C:\Tools\InstallerManager\` and run from there.

4. **Logs**  
   On startup errors, the app appends to `%TEMP%\InstallerManager\startup.log`.

5. **Self-contained build (no separate runtime install)**  
   From the repo root:

   ```powershell
   dotnet publish .\src\InstallerManager.App\InstallerManager.App.csproj -c Release -r win-x64 --self-contained true -o .\publish
   ```

   Run `.\publish\InstallerManager.exe`. The `Data` folder is optional if you rely on the embedded catalog; add `Data\catalog.json` to override without rebuilding.
