using System.IO;
using System.Reflection;
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
        if (!string.IsNullOrEmpty(path))
        {
            if (!File.Exists(path))
                throw new FileNotFoundException($"Catalog not found: {path}", path);
            return DeserializeFile(path);
        }

        foreach (var candidate in GetCatalogSearchPaths())
        {
            if (File.Exists(candidate))
                return DeserializeFile(candidate);
        }

        var embedded = TryDeserializeEmbedded();
        if (embedded is not null)
            return embedded;

        throw new FileNotFoundException(
            "Catalog not found on disk and no embedded catalog. Searched: "
            + string.Join(", ", GetCatalogSearchPaths()));
    }

    public static IReadOnlyList<string> GetCatalogSearchPaths()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<string>();
        void Add(string p)
        {
            if (seen.Add(p))
                list.Add(p);
        }

        var baseDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        Add(Path.Combine(baseDir, "Data", "catalog.json"));
        Add(Path.Combine(baseDir, "catalog.json"));

        var host = Environment.ProcessPath;
        if (!string.IsNullOrEmpty(host))
        {
            var exeDir = Path.GetDirectoryName(host);
            if (!string.IsNullOrEmpty(exeDir))
            {
                Add(Path.Combine(exeDir, "Data", "catalog.json"));
                Add(Path.Combine(exeDir, "catalog.json"));
            }
        }

        return list;
    }

    private static CatalogDocument DeserializeFile(string path)
    {
        var json = File.ReadAllText(path);
        return DeserializeJson(json);
    }

    private static CatalogDocument DeserializeJson(string json)
    {
        var doc = JsonSerializer.Deserialize<CatalogDocument>(json, JsonOptions);
        return doc ?? new CatalogDocument();
    }

    private static CatalogDocument? TryDeserializeEmbedded()
    {
        var asm = Assembly.GetExecutingAssembly();
        var name = asm.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("catalog.json", StringComparison.OrdinalIgnoreCase));
        if (name is null)
            return null;

        using var stream = asm.GetManifestResourceStream(name);
        if (stream is null)
            return null;

        using var reader = new StreamReader(stream);
        var json = reader.ReadToEnd();
        return DeserializeJson(json);
    }
}
