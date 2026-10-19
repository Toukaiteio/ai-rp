using System.Text;
using System.Text.Json;

namespace AiRp.Maui;

public sealed class NativeStore
{
    readonly string root;
    readonly object gate = new();

    public NativeStore(string appDataDirectory)
    {
        root = Path.Combine(appDataDirectory, "store");
        Directory.CreateDirectory(Path.Combine(root, "data"));
        Directory.CreateDirectory(Path.Combine(root, "local"));
    }

    public string? Get(string bucket, string key)
    {
        lock (gate)
        {
            var path = PathOf(bucket, key);
            return File.Exists(path) ? File.ReadAllText(path, Encoding.UTF8) : null;
        }
    }

    public void Set(string bucket, string key, string? value)
    {
        lock (gate) Write(PathOf(bucket, key), value ?? string.Empty);
    }

    public void Remove(string bucket, string key)
    {
        lock (gate)
        {
            var path = PathOf(bucket, key);
            if (File.Exists(path)) File.Delete(path);
        }
    }

    public string[] Keys(string bucket)
    {
        lock (gate)
        {
            return Directory.EnumerateFiles(BucketPath(bucket))
                .Where(path => !path.EndsWith(".tmp", StringComparison.Ordinal))
                .Select(path => Path.GetFileName(path))
                .Select(name => TryDecode(name, out var key) ? key : null)
                .Where(key => key is not null)
                .Cast<string>()
                .ToArray();
        }
    }

    public void Clear(string bucket)
    {
        lock (gate)
        {
            foreach (var path in Directory.EnumerateFiles(BucketPath(bucket))) File.Delete(path);
        }
    }

    public string PreferencesJson()
    {
        lock (gate)
        {
            var path = Path.Combine(root, "prefs.json");
            return File.Exists(path) ? File.ReadAllText(path, Encoding.UTF8) : "{}";
        }
    }

    public void SetPreference(string key, string? value)
    {
        lock (gate)
        {
            var preferences = JsonSerializer.Deserialize<Dictionary<string, string>>(PreferencesJson()) ?? new();
            if (value is null) preferences.Remove(key);
            else preferences[key] = value;
            Write(Path.Combine(root, "prefs.json"), JsonSerializer.Serialize(preferences));
        }
    }

    string BucketPath(string bucket) => bucket is "data" or "local"
        ? Path.Combine(root, bucket)
        : throw new InvalidOperationException("未知存储分区");

    string PathOf(string bucket, string key)
    {
        if (string.IsNullOrEmpty(key)) throw new InvalidOperationException("缺少键");
        return Path.Combine(BucketPath(bucket), Encode(key));
    }

    static void Write(string path, string value)
    {
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, value, Encoding.UTF8);
        if (OperatingSystem.IsWindows() && File.Exists(path)) File.Replace(temporary, path, null);
        else
        {
            File.Move(temporary, path, true);
        }
    }

    static string Encode(string key) => Convert.ToHexString(Encoding.UTF8.GetBytes(key)).ToLowerInvariant();

    static bool TryDecode(string name, out string key)
    {
        try
        {
            key = Encoding.UTF8.GetString(Convert.FromHexString(name));
            return true;
        }
        catch (FormatException)
        {
            key = string.Empty;
            return false;
        }
    }
}
