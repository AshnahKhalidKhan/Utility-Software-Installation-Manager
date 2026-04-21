using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Threading;

namespace InstallerManager.App;

public partial class App : Application
{
    public App()
    {
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        TryWriteStartupLog("Started.");
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        TryWriteStartupLog("DispatcherUnhandledException: " + e.Exception);
        MessageBox.Show(
            FormatException("Something went wrong in the application.", e.Exception),
            "Installer Manager — error",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
        e.Handled = true;
        Shutdown(1);
    }

    private void OnUnhandledException(object? sender, UnhandledExceptionEventArgs e)
    {
        if (e.ExceptionObject is not Exception ex)
            return;
        TryWriteStartupLog("UnhandledException: " + ex);
    }

    private static string FormatException(string title, Exception ex)
    {
        var sb = new StringBuilder();
        sb.AppendLine(title);
        sb.AppendLine();
        sb.AppendLine(ex.ToString());
        sb.AppendLine();
        sb.AppendLine("Application directory (BaseDirectory):");
        sb.AppendLine(AppContext.BaseDirectory);
        return sb.ToString();
    }

    private static void TryWriteStartupLog(string line)
    {
        try
        {
            var dir = Path.Combine(Path.GetTempPath(), "InstallerManager");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "startup.log");
            File.AppendAllText(path, $"{DateTime.UtcNow:O} {line}{Environment.NewLine}");
        }
        catch
        {
            // ignore logging failures
        }
    }
}
