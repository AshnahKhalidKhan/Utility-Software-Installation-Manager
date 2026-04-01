using System.Text.Json.Serialization;

namespace InstallerManager.App.Models;

public sealed class CatalogDocument
{
    public int Version { get; set; } = 1;
    public List<CatalogCategory> Categories { get; set; } = [];
}

public sealed class CatalogCategory
{
    public string Name { get; set; } = "";
    public List<CatalogItem> Items { get; set; } = [];
}

public sealed class CatalogItem
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Description { get; set; }
    public bool Optional { get; set; }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public InstallProviderKind Provider { get; set; }

    public string? WingetId { get; set; }
    public string? WingetVersion { get; set; }
    public string? WingetExtraInstallArgs { get; set; }
    public string? WingetExtraUninstallArgs { get; set; }

    public string? PowerShellInstall { get; set; }
    public string? PowerShellUninstall { get; set; }

    public List<CatalogStep>? Steps { get; set; }
}

public sealed class CatalogStep
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public InstallProviderKind Provider { get; set; }
    public string? WingetId { get; set; }
    public string? WingetVersion { get; set; }
    public string? WingetExtraInstallArgs { get; set; }
    public string? WingetExtraUninstallArgs { get; set; }
    public string? PowerShellInstall { get; set; }
    public string? PowerShellUninstall { get; set; }
}

public enum InstallProviderKind
{
    Winget,
    PowerShell,
    Composite
}
