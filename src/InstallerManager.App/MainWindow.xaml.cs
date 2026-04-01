using System.Windows;
using InstallerManager.App.Services;
using InstallerManager.App.ViewModels;

namespace InstallerManager.App;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        var catalog = new CatalogRepository().Load();
        var installer = new PackageInstaller(new ProcessRunner());
        DataContext = new MainViewModel(catalog, installer);
    }
}
