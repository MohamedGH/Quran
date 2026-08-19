import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.quranpath.app',
    appName: 'Quran Path',
    webDir: 'dist',
    bundledWebRuntime: false,
    server: {
        androidScheme: 'https'
    },
    plugins: {
        FirebaseAuthentication: {
            skipNativeAuth: false,
            providers: ['google.com'],   // ← this is what's missing
        },
    }
};

export default config;