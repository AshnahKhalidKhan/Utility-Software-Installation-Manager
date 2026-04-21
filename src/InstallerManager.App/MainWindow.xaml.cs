using System.IO;
using System.Text;
using System.Windows;
using InstallerManager.App.Services;
using InstallerManager.App.ViewModels;

namespace InstallerManager.App;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        try
        {
            var catalog = new CatalogRepository().Load();
            var installer = new PackageInstaller(new ProcessRunner());
            DataContext = new MainViewModel(catalog, installer);
        }
        catch (Exception ex)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Could not load the software catalog or finish starting the window.");
            sb.AppendLine();
            sb.AppendLine(ex.ToString());
            sb.AppendLine();
            sb.AppendLine("AppContext.BaseDirectory:");
            sb.AppendLine(AppContext.BaseDirectory);
            sb.AppendLine();
            sb.AppendLine("Catalog search paths tried:");
            foreach (var p in CatalogRepository.GetCatalogSearchPaths())
                sb.AppendLine("  " + p + (File.Exists(p) ? "  (found)" : "  (missing)"));

            MessageBox.Show(
                sb.ToString(),
                "Installer Manager — startup failed",
                MessageBoxButton.OK,
                MessageBoxImage.Error);

            Application.Current.Shutdown(1);
        }
    }
}
