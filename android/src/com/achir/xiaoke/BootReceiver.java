package com.achir.xiaoke;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 開機後自動打開小柯（Config.AUTO_START_ON_BOOT）。 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Config.AUTO_START_ON_BOOT || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        Intent i = new Intent(ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }
}
