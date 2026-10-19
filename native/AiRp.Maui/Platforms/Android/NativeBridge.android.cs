using Android.Webkit;
using Java.Interop;
using System.Text.Json;

namespace AiRp.Maui;

public static partial class NativeBridge
{
    public static void Attach(Microsoft.Maui.Controls.WebView browser, NativeStore store)
    {
        if (browser.Handler?.PlatformView is not Android.Webkit.WebView native) return;
        native.Settings.JavaScriptEnabled = true;
        native.Settings.DomStorageEnabled = true;
        native.AddJavascriptInterface(new AndroidStore(store), "AiRpStore");
        native.SetWebViewClient(new BridgeClient(store));
    }

    sealed class AndroidStore(NativeStore store) : Java.Lang.Object
    {
        [JavascriptInterface] public string? Get(string bucket, string key) => store.Get(bucket, key);
        [JavascriptInterface] public void Set(string bucket, string key, string value) => store.Set(bucket, key, value);
        [JavascriptInterface] public void Remove(string bucket, string key) => store.Remove(bucket, key);
        [JavascriptInterface] public string Keys(string bucket) => JsonSerializer.Serialize(store.Keys(bucket));
        [JavascriptInterface] public void Clear(string bucket) => store.Clear(bucket);
        [JavascriptInterface] public string PreferencesJson() => store.PreferencesJson();
        [JavascriptInterface] public void SetPreference(string key, string? value) => store.SetPreference(key, value);
    }

    sealed class BridgeClient(NativeStore store) : WebViewClient
    {
        public override void OnPageStarted(Android.Webkit.WebView? view, string? url, Android.Graphics.Bitmap? favicon)
        {
            base.OnPageStarted(view, url, favicon);
            view?.EvaluateJavascript(BootScript(store) + AndroidScript, null);
        }
    }

    const string AndroidScript = "window.__AI_RP_PREFS__=AiRpStore.preferencesJson();window.__AI_RP_NATIVE_PREF__=function(k,v){AiRpStore.setPreference(k,v);};window.__AI_RP_CALL__=function(m){return new Promise(function(r){try{var v=m.value==null?null:String(m.value),x=m.op==='get'?AiRpStore.get(m.bucket,m.key):m.op==='keys'?JSON.parse(AiRpStore.keys(m.bucket)):(m.op==='set'?(AiRpStore.set(m.bucket,m.key,v),null):m.op==='remove'?(AiRpStore.remove(m.bucket,m.key),null):(m.op==='clear'?(AiRpStore.clear(m.bucket),null):null));r(m.op==='get'?{ok:true,value:x}:m.op==='keys'?{ok:true,keys:x}:{ok:true});}catch(e){r({ok:false,error:String(e)});}});};";
}
