using System.IO;
using System.Text.Json;
using InstallerManager.App.Models;

namespace InstallerManager.App.Services;

public sealed class CatalogRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    public CatalogDocument Load(string? path = null)
    {
        path ??= Path.Combine(AppContext.BaseDirectory, "Data", "catalog.json");
        if (!File.Exists(path))
            throw new FileNotFoundException($"Catalog not found: {path}", path);

        var json = File.ReadAllText(path);
        var doc = JsonSerializer.Deserialize<CatalogDocument>(json, JsonOptions);
        return doc ?? new CatalogDocument();
    }
}
