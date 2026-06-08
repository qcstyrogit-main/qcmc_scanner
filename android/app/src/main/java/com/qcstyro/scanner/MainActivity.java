package com.qcstyro.scanner;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
  private BroadcastReceiver scannerReceiver;
  private Object sdkScanManager;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    WebView webView = getBridge().getWebView();
    WebSettings settings = webView.getSettings();
    settings.setSupportZoom(false);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    webView.addJavascriptInterface(new ScannerBridge(), "QcmcScanner");
  }

  public class ScannerBridge {
    @JavascriptInterface
    public void startScan() {
      runOnUiThread(() -> startScanner());
    }

    @JavascriptInterface
    public void stopScan() {
      runOnUiThread(() -> stopScanner());
    }
  }

  @Override
  public void onStart() {
    super.onStart();
    registerScannerReceiver();
    openSdkScanner();
  }

  @Override
  public void onStop() {
    stopScanner();
    unregisterScannerReceiver();
    super.onStop();
  }

  private void registerScannerReceiver() {
    if (scannerReceiver != null) {
      return;
    }

    scannerReceiver = new BroadcastReceiver() {
      @Override
      public void onReceive(Context context, Intent intent) {
        String code = readScannerCode(intent);
        if (code == null || code.trim().isEmpty()) {
          return;
        }
        stopScanner();
        sendScannerCodeToWeb(code.trim());
      }
    };

    IntentFilter filter = new IntentFilter();
    filter.addAction("android.intent.ACTION_DECODE_DATA");
    filter.addAction("com.android.server.scannerservice.broadcast");
    filter.addAction("com.scanner.broadcast");
    filter.addAction("com.barcode.sendBroadcast");
    filter.addAction("com.honeywell.decode.intent.action.SCAN_RESULT");
    filter.addAction("nlscan.action.SCANNER_RESULT");
    filter.addAction("com.symbol.datawedge.api.RESULT_ACTION");
    filter.addAction("com.qcstyro.scanner.SCAN");
    filter.addAction("scan_switch");

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(scannerReceiver, filter, Context.RECEIVER_EXPORTED);
    } else {
      registerReceiver(scannerReceiver, filter);
    }
  }

  private void unregisterScannerReceiver() {
    if (scannerReceiver == null) {
      return;
    }

    try {
      unregisterReceiver(scannerReceiver);
    } catch (IllegalArgumentException ignored) {
      // Receiver was already unregistered.
    }
    scannerReceiver = null;
  }

  private String readScannerCode(Intent intent) {
    if (intent == null) {
      return null;
    }

    List<String> preferredKeys = Arrays.asList(
      "SCAN_RESULT",
      "SCAN_RESULT_DATA",
      "RESULT",
      "result",
      "data",
      "barcode",
      "barcode_string",
      "barcodeString",
      "barcode_data",
      "barcodeData",
      "scannerdata",
      "scanner_data",
      "scan_data",
      "SCAN_BARCODE1",
      "SCAN_BARCODE2",
      "SCAN_BARCODE",
      "SCAN_RESULT",
      "SCAN_RESULT_DATA",
      "decode_rslt",
      "decode_data",
      "com.symbol.datawedge.data_string"
    );

    for (String key : preferredKeys) {
      String value = intent.getStringExtra(key);
      if (value != null && !value.trim().isEmpty()) {
        return value;
      }
    }

    Bundle extras = intent.getExtras();
    if (extras == null) {
      return null;
    }

    for (String key : extras.keySet()) {
      Object value = extras.get(key);
      if (value instanceof String) {
        String text = ((String) value).trim();
        if (!text.isEmpty()) {
          return text;
        }
      }
    }

    return null;
  }

  private void sendScannerCodeToWeb(String code) {
    WebView webView = getBridge().getWebView();
    if (webView == null) {
      return;
    }

    String quotedCode = JSONObject.quote(code);
    String script =
      "window.dispatchEvent(new CustomEvent('qcmc-scanner-data', { detail: { code: " +
      quotedCode +
      " } }));";

    webView.post(() -> webView.evaluateJavascript(script, null));
  }

  private void triggerScanner() {
    sendDawnScannerService("com.kte.service.scan.start");

    sendBroadcast(new Intent("android.intent.action.SCANBUTTONDOWN"));
    sendBroadcast(new Intent("android.intent.action.START_SCAN"));
    sendBroadcast(new Intent("com.android.server.scannerservice.scan"));
    sendBroadcast(new Intent("com.android.server.scannerservice.start"));
    sendBroadcast(new Intent("com.scanner.action.START_SCAN"));
    sendBroadcast(new Intent("com.scan.onStartScan"));
    sendBroadcast(new Intent("com.barcode.action.START_SCAN"));
    sendBroadcast(new Intent("com.qcstyro.scanner.START_SCAN"));

    Intent newlandIntent = new Intent("nlscan.action.SCANNER_TRIG");
    newlandIntent.putExtra("SCAN_TIMEOUT", 8);
    newlandIntent.putExtra("SCAN_TYPE", 1);
    sendBroadcast(newlandIntent);

    Intent dataWedgeIntent = new Intent("com.symbol.datawedge.api.ACTION");
    dataWedgeIntent.putExtra("com.symbol.datawedge.api.SOFT_SCAN_TRIGGER", "START_SCANNING");
    sendBroadcast(dataWedgeIntent);

    Intent honeywellIntent = new Intent("com.honeywell.aidc.action.ACTION_CONTROL_SCANNER");
    honeywellIntent.putExtra("com.honeywell.aidc.extra.EXTRA_SCAN", true);
    sendBroadcast(honeywellIntent);

    Intent scannerServiceIntent = new Intent("com.android.server.scannerservice.scan");
    scannerServiceIntent.putExtra("scan", true);
    scannerServiceIntent.putExtra("start", true);
    scannerServiceIntent.putExtra("SCAN", true);
    sendBroadcast(scannerServiceIntent);
  }

  private void startScanner() {
    if (startDawnScanner()) {
      return;
    }

    if (startSdkScanner()) {
      return;
    }

    triggerScanner();
  }

  private void stopScanner() {
    sendDawnScannerService("com.kte.service.scan.stop");
    sendDawnScannerService("com.kte.service.scan.close");

    Intent dataWedgeIntent = new Intent("com.symbol.datawedge.api.ACTION");
    dataWedgeIntent.putExtra("com.symbol.datawedge.api.SOFT_SCAN_TRIGGER", "STOP_SCANNING");
    sendBroadcast(dataWedgeIntent);

    Intent honeywellIntent = new Intent("com.honeywell.aidc.action.ACTION_CONTROL_SCANNER");
    honeywellIntent.putExtra("com.honeywell.aidc.extra.EXTRA_SCAN", false);
    sendBroadcast(honeywellIntent);
  }

  private boolean startDawnScanner() {
    return sendDawnScannerService("com.kte.service.scan.start");
  }

  private boolean sendDawnScannerService(String action) {
    Intent intent = new Intent(action);
    intent.setComponent(new ComponentName("com.dawn.java", "com.dawn.java.ui.ScanService"));

    try {
      ComponentName startedService = startService(intent);
      return startedService != null;
    } catch (Exception ignored) {
      return false;
    }
  }

  private boolean openSdkScanner() {
    Object manager = getSdkScanManager();
    if (manager == null) {
      return false;
    }

    return invokeSdkMethod(manager, "openScanner") ||
      invokeSdkMethod(manager, "open") ||
      invokeSdkMethod(manager, "scannerOpen");
  }

  private boolean startSdkScanner() {
    Object manager = getSdkScanManager();
    if (manager == null) {
      return false;
    }

    openSdkScanner();

    return invokeSdkMethod(manager, "startDecode") ||
      invokeSdkMethod(manager, "startScan") ||
      invokeSdkMethod(manager, "scan") ||
      invokeSdkMethod(manager, "start") ||
      invokeSdkMethod(manager, "triggerScan");
  }

  private Object getSdkScanManager() {
    if (sdkScanManager != null) {
      return sdkScanManager;
    }

    List<String> classNames = Arrays.asList(
      "android.device.ScanManager",
      "com.android.scanner.service.ScanManager",
      "com.android.server.scannerservice.ScanManager"
    );

    for (String className : classNames) {
      try {
        Class<?> managerClass = Class.forName(className);
        sdkScanManager = managerClass.getDeclaredConstructor().newInstance();
        return sdkScanManager;
      } catch (Exception ignored) {
        // Try the next scanner SDK class name.
      }
    }

    return null;
  }

  private boolean invokeSdkMethod(Object target, String methodName) {
    try {
      Method method = target.getClass().getMethod(methodName);
      Object result = method.invoke(target);
      return !(result instanceof Boolean) || (Boolean) result;
    } catch (Exception ignored) {
      return false;
    }
  }

}
