using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using InstallerManager.App.Models;
using InstallerManager.App.Services;

namespace InstallerManager.App.ViewModels;

public sealed partial class MainViewModel : ObservableObject
{
    private readonly PackageInstaller _installer;

    public MainViewModel(CatalogDocument catalog, PackageInstaller installer)
    {
        _installer = installer;
        foreach (var category in catalog.Categories)
        {
            foreach (var item in category.Items)
                Items.Add(new SoftwareItemViewModel(item, category.Name));
        }

        var sorted = Items.OrderBy(i => i.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(i => i.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        Items.Clear();
        foreach (var row in sorted)
            Items.Add(row);
    }

    public ObservableCollection<SoftwareItemViewModel> Items { get; } = [];

    [ObservableProperty]
    private string _activityLog = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(InstallSelectedCommand))]
    [NotifyCanExecuteChangedFor(nameof(UninstallSelectedCommand))]
    private bool _isBusy;

    private bool CanRun() => !IsBusy;

    [RelayCommand(CanExecute = nameof(CanRun))]
    private async Task InstallSelectedAsync()
    {
        var selected = Items.Where(i => i.IsSelected).Select(i => i.Item).ToList();
        if (selected.Count == 0)
        {
            AppendLog("No packages selected.");
            return;
        }

        IsBusy = true;
        try
        {
            foreach (var item in selected)
            {
                AppendLog($"--- Install: {item.DisplayName} ---");
                var outcome = await _installer
                    .InstallAsync(item, AppendLog, CancellationToken.None)
                    .ConfigureAwait(true);

                AppendLog(outcome.Success ? "Completed." : "Failed.");
                if (!string.IsNullOrWhiteSpace(outcome.Message))
                    AppendLog(outcome.Message.TrimEnd());

                if (!outcome.Success)
                    break;
            }
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand(CanExecute = nameof(CanRun))]
    private async Task UninstallSelectedAsync()
    {
        var selected = Items.Where(i => i.IsSelected).Select(i => i.Item).ToList();
        if (selected.Count == 0)
        {
            AppendLog("No packages selected.");
            return;
        }

        IsBusy = true;
        try
        {
            foreach (var item in selected)
            {
                AppendLog($"--- Uninstall: {item.DisplayName} ---");
                var outcome = await _installer
                    .UninstallAsync(item, AppendLog, CancellationToken.None)
                    .ConfigureAwait(true);

                AppendLog(outcome.Success ? "Completed." : "Failed.");
                if (!string.IsNullOrWhiteSpace(outcome.Message))
                    AppendLog(outcome.Message.TrimEnd());

                if (!outcome.Success)
                    break;
            }
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void AppendLog(string line)
    {
        ActivityLog += line + Environment.NewLine;
    }
}
