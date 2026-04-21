using System.Collections.ObjectModel;
using System.Security.Principal;
using System.Windows;
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
        IsRunningElevated = IsProcessElevated();
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

    /// <summary>True when the process has an elevated token (Run as administrator).</summary>
    public bool IsRunningElevated { get; }

    public bool ShowElevationBanner => !IsRunningElevated;

    public ObservableCollection<SoftwareItemViewModel> Items { get; } = [];

    private static bool IsProcessElevated()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    [ObservableProperty]
    private string _activityLog = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(InstallSelectedCommand))]
    [NotifyCanExecuteChangedFor(nameof(UninstallSelectedCommand))]
    private bool _isBusy;

    private bool CanRun() => !IsBusy;

    [RelayCommand]
    private void RestartAsAdministrator()
    {
        ElevationHelper.RestartElevated();
    }

    [RelayCommand(CanExecute = nameof(CanRun))]
    private async Task InstallSelectedAsync()
    {
        if (!IsRunningElevated)
        {
            var answer = MessageBox.Show(
                "Installing packages requires running as Administrator.\n\n" +
                "Click Yes to restart with a UAC prompt (recommended).\n" +
                "Click No to cancel.",
                "Administrator rights required",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (answer == MessageBoxResult.Yes)
                ElevationHelper.RestartElevated();
            return;
        }

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
        if (!IsRunningElevated)
        {
            var answer = MessageBox.Show(
                "Uninstalling packages requires running as Administrator.\n\n" +
                "Click Yes to restart with a UAC prompt (recommended).\n" +
                "Click No to cancel.",
                "Administrator rights required",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (answer == MessageBoxResult.Yes)
                ElevationHelper.RestartElevated();
            return;
        }

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
