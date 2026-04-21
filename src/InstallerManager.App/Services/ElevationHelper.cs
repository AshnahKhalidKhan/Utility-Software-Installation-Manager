using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;

namespace InstallerManager.App.Services;

/// <summary>
/// Restarts the current app through UAC. Handles both the normal apphost (InstallerManager.exe)
/// and <c>dotnet run</c>, where the running process is dotnet.exe loading the app DLL.
/// </summary>
public static class ElevationHelper
{
    /// <summary>
    /// Starts an elevated instance and closes this process. No-op if executable cannot be resolved.
    /// </summary>
    public static void RestartElevated()
    {
        var start = CreateElevatedStartInfo();
        if (start is null)
        {
            MessageBox.Show(
                "Could not determine how to restart elevated. Run InstallerManager.exe from Explorer with Run as administrator, or open an elevated terminal and use: dotnet run",
                "Restart elevated",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        try
        {
            Process.Start(start);
            Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"Could not start an elevated process: {ex.Message}",
                "Elevation",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private static ProcessStartInfo? CreateElevatedStartInfo()
    {
        var hostPath = Environment.ProcessPath;
        var dllPath = ResolveManagedDllPath();

        if (string.IsNullOrEmpty(hostPath))
            return null;

        var psi = new ProcessStartInfo
        {
            UseShellExecute = true,
            Verb = "runas",
        };

        // dotnet run → process is dotnet.exe; relaunch with dotnet exec <app>.dll
        if (hostPath.EndsWith("dotnet.exe", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrEmpty(dllPath)
            && dllPath.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
        {
            psi.FileName = hostPath;
            psi.Arguments = $"exec \"{dllPath}\"";
            psi.WorkingDirectory = AppContext.BaseDirectory;
            return psi;
        }

        // Normal: apphost .exe (including self-contained single-file)
        psi.FileName = hostPath;
        psi.WorkingDirectory = Path.GetDirectoryName(hostPath) ?? AppContext.BaseDirectory;
        return psi;
    }

    /// <summary>
    /// Single-file publish leaves <see cref="Assembly.Location"/> empty; fall back to &lt;BaseDirectory&gt;/&lt;AssemblyName&gt;.dll after extraction.
    /// </summary>
    private static string? ResolveManagedDllPath()
    {
#pragma warning disable IL3000 // Empty in single-file; fallback uses BaseDirectory + assembly name
        var loc = Assembly.GetExecutingAssembly().Location;
#pragma warning restore IL3000
        if (!string.IsNullOrEmpty(loc))
            return loc;

        var name = Assembly.GetExecutingAssembly().GetName().Name;
        if (string.IsNullOrEmpty(name))
            return null;

        var candidate = Path.Combine(AppContext.BaseDirectory, name + ".dll");
        return File.Exists(candidate) ? candidate : null;
    }
}
