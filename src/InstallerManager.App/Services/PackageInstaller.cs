using System.IO;
using System.Text;
using InstallerManager.App.Models;

namespace InstallerManager.App.Services;

public sealed class PackageInstaller(ProcessRunner runner)
{
    private const string WingetAccept =
        "--accept-source-agreements --accept-package-agreements --disable-interactivity";

    public async Task<InstallOutcome> InstallAsync(
        CatalogItem item,
        Action<string> log,
        CancellationToken cancellationToken = default)
    {
        return item.Provider switch
        {
            InstallProviderKind.Winget => await WingetInstallAsync(item, log, cancellationToken),
            InstallProviderKind.PowerShell => await PowerShellAsync(item.PowerShellInstall, log, cancellationToken),
            InstallProviderKind.Composite => await CompositeInstallAsync(item, log, cancellationToken),
            _ => new InstallOutcome(false, "Unsupported provider.")
        };
    }

    public async Task<InstallOutcome> UninstallAsync(
        CatalogItem item,
        Action<string> log,
        CancellationToken cancellationToken = default)
    {
        return item.Provider switch
        {
            InstallProviderKind.Winget => await WingetUninstallAsync(item, log, cancellationToken),
            InstallProviderKind.PowerShell => await PowerShellAsync(item.PowerShellUninstall, log, cancellationToken),
            InstallProviderKind.Composite => await CompositeUninstallAsync(item, log, cancellationToken),
            _ => new InstallOutcome(false, "Unsupported provider.")
        };
    }

    private async Task<InstallOutcome> CompositeInstallAsync(
        CatalogItem item,
        Action<string> log,
        CancellationToken cancellationToken)
    {
        if (item.Steps is null || item.Steps.Count == 0)
            return new InstallOutcome(false, "Composite item has no steps.");

        var sb = new StringBuilder();
        foreach (var step in item.Steps)
        {
            var outcome = step.Provider switch
            {
                InstallProviderKind.Winget => await WingetInstallStepAsync(step, log, cancellationToken),
                InstallProviderKind.PowerShell => await PowerShellAsync(step.PowerShellInstall, log, cancellationToken),
                _ => new InstallOutcome(false, $"Unsupported step provider: {step.Provider}")
            };

            sb.AppendLine(outcome.Message);
            if (!outcome.Success)
                return new InstallOutcome(false, sb.ToString());
        }

        return new InstallOutcome(true, sb.ToString());
    }

    private async Task<InstallOutcome> CompositeUninstallAsync(
        CatalogItem item,
        Action<string> log,
        CancellationToken cancellationToken)
    {
        if (item.Steps is null || item.Steps.Count == 0)
            return new InstallOutcome(false, "Composite item has no steps.");

        var sb = new StringBuilder();
        for (var i = item.Steps.Count - 1; i >= 0; i--)
        {
            var step = item.Steps[i];
            var outcome = step.Provider switch
            {
                InstallProviderKind.Winget => await WingetUninstallStepAsync(step, log, cancellationToken),
                InstallProviderKind.PowerShell => await PowerShellAsync(step.PowerShellUninstall, log, cancellationToken),
                _ => new InstallOutcome(false, $"Unsupported step provider: {step.Provider}")
            };

            sb.AppendLine(outcome.Message);
            if (!outcome.Success)
                return new InstallOutcome(false, sb.ToString());
        }

        return new InstallOutcome(true, sb.ToString());
    }

    private async Task<InstallOutcome> WingetInstallAsync(
        CatalogItem item,
        Action<string> log,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(item.WingetId))
            return new InstallOutcome(false, "WingetId is required.");

        var version = string.IsNullOrWhiteSpace(item.WingetVersion) ? "" : $" --version \"{item.WingetVersion}\"";
        var extra = string.IsNullOrWhiteSpace(item.WingetExtraInstallArgs) ? "" : " " + item.WingetExtraInstallArgs;
        var args = $"install --id {item.WingetId} -e {version} {WingetAccept}{extra}";
        return await RunWingetAsync(args, log, cancellationToken);
    }

    private async Task<InstallOutcome> WingetUninstallAsync(
        CatalogItem item,
        Action<string> log,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(item.WingetId))
            return new InstallOutcome(false, "WingetId is required.");

        var extra = string.IsNullOrWhiteSpace(item.WingetExtraUninstallArgs) ? "" : " " + item.WingetExtraUninstallArgs;
        var args = $"uninstall --id {item.WingetId} -e {WingetAccept}{extra}";
        return await RunWingetAsync(args, log, cancellationToken);
    }

    private async Task<InstallOutcome> WingetInstallStepAsync(
        CatalogStep step,
        Action<string> log,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(step.WingetId))
            return new InstallOutcome(false, "WingetId is required.");

        var version = string.IsNullOrWhiteSpace(step.WingetVersion) ? "" : $" --version \"{step.WingetVersion}\"";
        var extra = string.IsNullOrWhiteSpace(step.WingetExtraInstallArgs) ? "" : " " + step.WingetExtraInstallArgs;
        var args = $"install --id {step.WingetId} -e {version} {WingetAccept}{extra}";
        return await RunWingetAsync(args, log, cancellationToken);
    }

    private async Task<InstallOutcome> WingetUninstallStepAsync(
        CatalogStep step,
        Action<string> log,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(step.WingetId))
            return new InstallOutcome(false, "WingetId is required.");

        var extra = string.IsNullOrWhiteSpace(step.WingetExtraUninstallArgs) ? "" : " " + step.WingetExtraUninstallArgs;
        var args = $"uninstall --id {step.WingetId} -e {WingetAccept}{extra}";
        return await RunWingetAsync(args, log, cancellationToken);
    }

    private async Task<InstallOutcome> RunWingetAsync(string arguments, Action<string> log, CancellationToken cancellationToken)
    {
        var winget = ResolveWingetPath();
        if (winget is null)
            return new InstallOutcome(false, "winget.exe not found. Install App Installer from the Microsoft Store.");

        var result = await runner.RunAsync(winget, arguments, log, cancellationToken).ConfigureAwait(false);
        var combined = result.StandardOutput + result.StandardError;
        var ok = result.ExitCode == 0;
        return new InstallOutcome(ok, combined);
    }

    private static string? ResolveWingetPath()
    {
        var local = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Microsoft", "WindowsApps", "winget.exe");
        if (File.Exists(local))
            return local;

        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (!string.IsNullOrEmpty(pathEnv))
        {
            foreach (var segment in pathEnv.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            {
                var candidate = Path.Combine(segment.Trim(), "winget.exe");
                if (File.Exists(candidate))
                    return candidate;
            }
        }

        return null;
    }

    private async Task<InstallOutcome> PowerShellAsync(string? script, Action<string> log, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(script))
            return new InstallOutcome(false, "No PowerShell script defined for this action.");

        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        var args = $"-NoProfile -ExecutionPolicy Bypass -EncodedCommand {encoded}";
        var result = await runner
            .RunAsync("powershell.exe", args, log, cancellationToken)
            .ConfigureAwait(false);

        var combined = result.StandardOutput + result.StandardError;
        return new InstallOutcome(result.ExitCode == 0, combined);
    }
}

public readonly record struct InstallOutcome(bool Success, string Message);
