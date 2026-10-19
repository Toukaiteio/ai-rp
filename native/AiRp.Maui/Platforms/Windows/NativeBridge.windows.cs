using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using System.Text.Json;

namespace AiRp.Maui;

public static partial class NativeBridge
{
    public static void Attach(Microsoft.Maui.Controls.WebView browser, NativeStore store)
    {
        if (browser.Handler?.PlatformView is not WebView2 native) return;
        native.CoreWebView2InitializationCompleted += async (_, _) =>
        {
            if (native.CoreWebView2 is not null)
                await native.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BootScript(store) + WindowsScript);
        };
        native.WebMessageReceived += (_, args) =>
        {
            try
            {
                var response = Handle(store, args.WebMessageAsJson);
                if (response is not null) native.CoreWebView2.PostWebMessageAsJson(response);
            }
            catch (Exception error)
            {
                native.CoreWebView2.PostWebMessageAsJson($"{{\"ok\":false,\"error\":{JsonSerializer.Serialize(error.Message)}}}");
            }
        };
    }

    const string WindowsScript = "window.__AI_RP_NATIVE_PREF__=function(k,v){chrome.webview.postMessage({op:'pref-set',key:k,value:v});};window.__AI_RP_SEQ__=0;window.__AI_RP_PENDING__={};window.__AI_RP_CALL__=function(m){return new Promise(function(r){var id=++window.__AI_RP_SEQ__;window.__AI_RP_PENDING__[id]=r;chrome.webview.postMessage({id:id,op:m.op,bucket:m.bucket,key:m.key,value:m.value});});};chrome.webview.addEventListener('message',function(e){var r=e.data,x=window.__AI_RP_PENDING__[r.id];if(x){delete window.__AI_RP_PENDING__[r.id];x(r);}});";
}
