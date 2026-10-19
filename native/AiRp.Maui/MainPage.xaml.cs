namespace AiRp.Maui;

public partial class MainPage : ContentPage
{
    readonly NativeStore store;

    public MainPage()
    {
        InitializeComponent();
        store = new NativeStore(FileSystem.AppDataDirectory);
        Browser.Source = AppConfig.Url;
        Browser.HandlerChanged += (_, _) => NativeBridge.Attach(Browser, store);
    }
}
