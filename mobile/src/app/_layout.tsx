import { NunitoSans_400Regular, NunitoSans_600SemiBold, NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans';
import { Quicksand_600SemiBold, Quicksand_700Bold } from '@expo-google-fonts/quicksand';
import * as Notifications from 'expo-notifications';
import { router, Stack, usePathname } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider } from '@/lib/store.tsx';
import { usePalette } from '@/lib/theme.ts';
import { ToastProvider } from '@/ui/kit.tsx';

/** Opens the capture screen whenever something is shared to Tula while the app is running. */
function ShareWatcher() {
  const { hasShareIntent } = useShareIntentContext();
  const pathname = usePathname();
  useEffect(() => {
    if (hasShareIntent && pathname !== '/capture') router.push({ pathname: '/capture', params: { mode: 'share' } });
  }, [hasShareIntent, pathname]);
  return null;
}

/** Tapping a reminder opens Today. */
function ReminderTaps() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener(() => router.navigate('/'));
    return () => sub.remove();
  }, []);
  return null;
}

export default function RootLayout() {
  const p = usePalette();
  const [fontsLoaded] = useFonts({ Quicksand_600SemiBold, Quicksand_700Bold, NunitoSans_400Regular, NunitoSans_600SemiBold, NunitoSans_700Bold });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: p.bg }} />;
  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <StoreProvider>
          <ToastProvider>
            <StatusBar style={p.dark ? 'light' : 'dark'} />
            <ShareWatcher />
            <ReminderTaps />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
            </Stack>
          </ToastProvider>
        </StoreProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
