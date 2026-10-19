using System.Text.Json;

namespace AiRp.Maui;

public static partial class NativeBridge
{
    internal static string BootScript(NativeStore store) => $"window.__AI_RP_NATIVE__=true;window.__AI_RP_PREFS__={JsonSerializer.Serialize(store.PreferencesJson())};" +
        "(function(){var snap=JSON.parse(window.__AI_RP_PREFS__||'{}');try{for(var k in snap)localStorage.setItem(k,snap[k]);}catch(e){}" +
        "var set=localStorage.setItem.bind(localStorage),remove=localStorage.removeItem.bind(localStorage);" +
        "localStorage.setItem=function(k,v){set(k,String(v));window.__AI_RP_NATIVE_PREF__(String(k),String(v));};" +
        "localStorage.removeItem=function(k){remove(k);window.__AI_RP_NATIVE_PREF__(String(k),null);};})();";

    internal static string? Handle(NativeStore store, string message)
    {
        using var document = JsonDocument.Parse(message);
        var root = document.RootElement;
        var operation = root.GetProperty("op").GetString();
        if (operation == "pref-set")
        {
            store.SetPreference(root.GetProperty("key").GetString()!, root.TryGetProperty("value", out var value) && value.ValueKind != JsonValueKind.Null ? value.GetString() : null);
            return null;
        }
        var id = root.GetProperty("id");
        var bucket = root.GetProperty("bucket").GetString()!;
        var key = root.TryGetProperty("key", out var keyValue) ? keyValue.GetString() : null;
        object result = operation switch
        {
            "get" => new { id, ok = true, value = store.Get(bucket, key!) },
            "set" => Set(store, bucket, key!, root),
            "remove" => Remove(store, id, bucket, key!),
            "keys" => new { id, ok = true, keys = store.Keys(bucket) },
            "clear" => Clear(store, id, bucket),
            _ => new { id, ok = false, error = "未知操作" }
        };
        return JsonSerializer.Serialize(result);
    }

    static object Set(NativeStore store, string bucket, string key, JsonElement root)
    {
        store.Set(bucket, key, root.TryGetProperty("value", out var value) ? value.GetString() : null);
        return new { id = root.GetProperty("id"), ok = true };
    }

    static object Remove(NativeStore store, JsonElement id, string bucket, string key) { store.Remove(bucket, key); return new { id, ok = true }; }
    static object Clear(NativeStore store, JsonElement id, string bucket) { store.Clear(bucket); return new { id, ok = true }; }
}
