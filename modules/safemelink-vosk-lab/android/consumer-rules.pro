# Explicit reflection/native boundaries for the experimental ON variant only.
-keep class com.tiziano.safemelink.vosklab.VoskLabModule { *; }
-keep class com.tiziano.safemelink.vosklab.VoskLabService { *; }
-keep interface com.tiziano.safemelink.vosklab.VoskLabService$WordLookup { *; }
-keep class org.vosk.** { *; }
-keep class com.sun.jna.** { *; }
