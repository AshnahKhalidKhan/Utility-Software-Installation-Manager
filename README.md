# Utility Software Installation Manager

Windows desktop tool for technical teams to **install** or **uninstall** a curated set of build and troubleshooting software. The list is **data-driven** (`Data/catalog.json`) so you can pin versions, swap package IDs, or add PowerShell steps without recompiling.

## Requirements

- Windows 10/11
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (to build)
- [winget](https://learn.microsoft.com/windows/package-manager/winget/) (App Installer / Microsoft Store) for most packages
- Run elevated: the app manifest requests **Administrator** so installs can succeed

## Run from source

```powershell
cd src/InstallerManager.App
dotnet run
```

Or open `InstallerManager.sln` in Visual Studio and start the **InstallerManager** project.

## Customize the catalog

Edit `src/InstallerManager.App/Data/catalog.json` (copied next to the built `.exe` under `Data\`).

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
