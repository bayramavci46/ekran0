package io.github.bayramavci46.kurgumasasi;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Until the editor paints, the window's colour (light or dark, like the editor's) shows through.
        if (bridge != null) bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
    }
}
