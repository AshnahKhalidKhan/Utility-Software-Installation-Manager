using CommunityToolkit.Mvvm.ComponentModel;
using InstallerManager.App.Models;

namespace InstallerManager.App.ViewModels;

public sealed partial class SoftwareItemViewModel : ObservableObject
{
    public SoftwareItemViewModel(CatalogItem item, string category)
    {
        Item = item;
        Category = category;
        VersionHint = string.IsNullOrWhiteSpace(item.WingetVersion) ? "latest" : item.WingetVersion!;
        IsSelected = !item.Optional;
    }

    public CatalogItem Item { get; }
    public string Category { get; }
    public string DisplayName => Item.DisplayName;
    public string VersionHint { get; }
    public string? Notes => Item.Description;

    [ObservableProperty]
    private bool _isSelected;
}
