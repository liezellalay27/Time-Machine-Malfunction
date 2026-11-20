import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STORAGE_KEY = 'daybreak-alarms-v1';
const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Device local time';
const QUICK_REPEATS = [
  { title: 'Once', days: [] },
  { title: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { title: 'Weekends', days: [0, 6] },
  { title: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const pad = (value) => String(value).padStart(2, '0');
const formatTime = (hour, minute) => `${hour % 12 || 12}:${pad(minute)} ${hour >= 12 ? 'PM' : 'AM'}`;

function repeatLabel(days = []) {
  const match = QUICK_REPEATS.find((preset) => preset.days.length === days.length && preset.days.every((day) => days.includes(day)));
  return match?.title || (days.length ? days.map((day) => DAY_NAMES[day]).join(' · ') : 'Once');
}

function nextOccurrence(alarm, from = new Date()) {
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(from);
    date.setDate(from.getDate() + offset);
    date.setHours(alarm.hour, alarm.minute, 0, 0);
    if (offset === 0 && date <= from) continue;
    if (alarm.days?.length && !alarm.days.includes(date.getDay())) continue;
    return date;
  }
  return null;
}

function relativeDate(date, now = new Date()) {
  if (!date) return 'No upcoming alarm';
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const target = new Date(date); target.setHours(0, 0, 0, 0);
  const dayDelta = Math.round((target - start) / 86400000);
  if (dayDelta === 0) return 'Today';
  if (dayDelta === 1) return 'Tomorrow';
  return DAY_NAMES[date.getDay()];
}

function countdown(date, now = new Date()) {
  if (!date) return '';
  const minutes = Math.max(1, Math.ceil((date - now) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `in ${remainder} min`;
  return remainder ? `in ${hours} hr ${remainder} min` : `in ${hours} hr`;
}

async function syncAlarm(method, alarm) {
  try {
    const url = `${API_URL}/alarms${method === 'POST' ? '' : `/${alarm.id}`}`;
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(alarm) }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function scheduleAlarm(alarm) {
  const oldIds = alarm.notificationIds || (alarm.notificationId ? [alarm.notificationId] : []);
  await Promise.all(oldIds.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  if (!alarm.enabled) return [];

  const content = {
    title: alarm.label || 'Wake up',
    body: 'Your alarm is ringing. Good morning!',
    sound: 'default',
    data: { alarmId: alarm.id },
  };

  if (alarm.days?.length) {
    return Promise.all(alarm.days.map((day) => Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: day + 1,
        hour: alarm.hour,
        minute: alarm.minute,
        repeats: true,
        channelId: 'alarms',
      },
    })));
  }

  const date = new Date();
  date.setHours(alarm.hour, alarm.minute, 0, 0);
  if (date <= new Date()) date.setDate(date.getDate() + 1);
  const id = await Notifications.scheduleNotificationAsync({
    content,
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'alarms' },
  });
  return [id];
}

function Button({ title, onPress, secondary = false, style, themeStyles = baseStyles }) {
  return (
    <Pressable onPress={onPress} style={[themeStyles.button, secondary && themeStyles.buttonSecondary, style]}>
      <Text style={[themeStyles.buttonText, secondary && themeStyles.buttonSecondaryText]}>{title}</Text>
    </Pressable>
  );
}

export default function App() {
  const [alarms, setAlarms] = useState([]);
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [hour, setHour] = useState('07');
  const [minute, setMinute] = useState('00');
  const [ampm, setAmpm] = useState('AM');
  const [label, setLabel] = useState('Wake up');
  const [days, setDays] = useState([]);
  const [now, setNow] = useState(new Date());
  const [timeZone, setTimeZone] = useState(localTimeZone());
  const [saving, setSaving] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const styles = useMemo(() => makeThemeStyles(baseStyles, darkMode), [darkMode]);

  useEffect(() => {
    AsyncStorage.getItem('time-machine-theme').then((value) => {
      if (value === 'light') setDarkMode(false);
      if (value === 'dark') setDarkMode(true);
    }).catch(() => {});
  }, []);

  const toggleTheme = async () => {
    const next = !darkMode;
    setDarkMode(next);
    await AsyncStorage.setItem('time-machine-theme', next ? 'dark' : 'light').catch(() => {});
  };

  useEffect(() => {
    Notifications.requestPermissionsAsync();
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('alarms', {
        name: 'Alarms', importance: Notifications.AndroidImportance.MAX,
        sound: 'default', vibrationPattern: [0, 400, 250, 400],
      });
    }

    const ticker = setInterval(() => setNow(new Date()), 30_000);
    (async () => {
      let localAlarms = [];
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) localAlarms = JSON.parse(saved);
      } catch { /* Start with an empty alarm list when local storage is unavailable. */ }

      const detectedZone = localTimeZone();
      localAlarms = await Promise.all(localAlarms.map(async (alarm) => {
        if (alarm.enabled && alarm.scheduledTimeZone !== detectedZone) {
          try {
            return { ...alarm, scheduledTimeZone: detectedZone, notificationIds: await scheduleAlarm(alarm) };
          } catch { return { ...alarm, scheduledTimeZone: detectedZone }; }
        }
        return { ...alarm, scheduledTimeZone: detectedZone };
      }));
      setTimeZone(detectedZone);

      let merged = localAlarms;
      try {
        const response = await fetch(`${API_URL}/alarms`);
        if (response.ok) {
          const remoteAlarms = await response.json();
          const localIds = new Set(localAlarms.map((alarm) => alarm.id));
          const imported = await Promise.all(remoteAlarms.filter((alarm) => !localIds.has(alarm.id)).map(async (alarm) => ({
            ...alarm,
            scheduledTimeZone: detectedZone,
            notificationIds: await scheduleAlarm(alarm),
          })));
          merged = [...localAlarms, ...imported];
          await Promise.all(localAlarms.map((alarm) => syncAlarm('POST', alarm)));
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        }
      } catch { /* Alarms saved on the phone stay available offline. */ }
      setAlarms(merged);
      setReady(true);
    })();
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const detectedZone = localTimeZone();
      setTimeZone(detectedZone);
      const currentAlarms = alarms;
      if (!currentAlarms.some((alarm) => alarm.enabled && alarm.scheduledTimeZone !== detectedZone)) return;
      const updated = await Promise.all(currentAlarms.map(async (alarm) => {
        if (!alarm.enabled || alarm.scheduledTimeZone === detectedZone) return alarm;
        try {
          return { ...alarm, scheduledTimeZone: detectedZone, notificationIds: await scheduleAlarm(alarm) };
        } catch { return { ...alarm, scheduledTimeZone: detectedZone }; }
      }));
      setAlarms(updated);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      await Promise.all(updated.map((alarm) => syncAlarm('POST', alarm)));
    });
    return () => subscription.remove();
  }, [alarms]);

  const activeAlarms = alarms.filter((alarm) => alarm.enabled);
  const upcoming = useMemo(() => activeAlarms
    .map((alarm) => ({ alarm, date: nextOccurrence(alarm, now) }))
    .sort((a, b) => (a.date?.getTime() || Infinity) - (b.date?.getTime() || Infinity))[0], [alarms, now]);
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const persist = async (items) => {
    setAlarms(items);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  };

  const openNew = () => {
    const date = new Date(); date.setMinutes(date.getMinutes() + 1);
    setEditing(null);
    setHour(pad(date.getHours() % 12 || 12));
    setMinute(pad(date.getMinutes()));
    setAmpm(date.getHours() >= 12 ? 'PM' : 'AM');
    setLabel('Wake up'); setDays([]); setModal(true);
  };

  const openEdit = (alarm) => {
    setEditing(alarm); setHour(pad(alarm.hour % 12 || 12)); setMinute(pad(alarm.minute));
    setAmpm(alarm.hour >= 12 ? 'PM' : 'AM'); setLabel(alarm.label || 'Alarm'); setDays(alarm.days || []); setModal(true);
  };

  const saveAlarm = async () => {
    const h = Number(hour); const m = Number(minute);
    if (!Number.isInteger(h) || h < 1 || h > 12 || !Number.isInteger(m) || m < 0 || m > 59) {
      Alert.alert('Check the time', 'Enter an hour from 1 to 12 and minutes from 00 to 59.');
      return;
    }
    setSaving(true);
    try {
      const actualHour = (h % 12) + (ampm === 'PM' ? 12 : 0);
      const base = editing || { id: uid(), enabled: true };
      const item = { ...base, hour: actualHour, minute: m, label: label.trim() || 'Alarm', days, scheduledTimeZone: timeZone };
      item.notificationIds = await scheduleAlarm(item);
      const updated = editing ? alarms.map((alarm) => alarm.id === item.id ? item : alarm) : [...alarms, item];
      await persist(updated);
      syncAlarm('POST', item);
      setModal(false);
    } catch {
      Alert.alert('Could not set alarm', 'Please check notification permissions and try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAlarm = async (alarm, enabled) => {
    const item = { ...alarm, enabled, scheduledTimeZone: timeZone };
    try {
      item.notificationIds = await scheduleAlarm(item);
      const updated = alarms.map((entry) => entry.id === item.id ? item : entry);
      await persist(updated); syncAlarm('POST', item);
    } catch {
      Alert.alert('Could not update alarm', 'Please check notification permissions and try again.');
    }
  };

  const deleteAlarm = (alarm) => Alert.alert('Delete alarm?', `Remove ${formatTime(alarm.hour, alarm.minute)}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      const ids = alarm.notificationIds || (alarm.notificationId ? [alarm.notificationId] : []);
      await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
      await persist(alarms.filter((entry) => entry.id !== alarm.id));
      syncAlarm('DELETE', alarm);
    } },
  ]);

  const toggleDay = (day) => setDays((current) => current.includes(day)
    ? current.filter((item) => item !== day)
    : [...current, day].sort());

  const selectRepeat = (presetDays) => setDays(presetDays);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topline}>
            <View>
              <Text style={styles.brand}>Time Machine<Text style={styles.brandDot}>.</Text></Text>
              <Text style={styles.brandCaption}>YOUR MORNING, YOUR WAY</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${darkMode ? 'light' : 'dark'} mode`} onPress={toggleTheme} style={styles.sunBadge}>
              <Text style={styles.sunGlyph}>{darkMode ? '☼' : '☾'}</Text>
              <Text style={styles.themeButtonLabel}>{darkMode ? 'DARK' : 'LIGHT'}</Text>
            </Pressable>
          </View>

          <Text style={styles.greeting}>{greeting}<Text style={styles.greetingDot}>.</Text></Text>
          <Text style={styles.dateLine}>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
          <View style={styles.zoneBadge}><Text style={styles.zoneDot}>●</Text><Text style={styles.zoneText}>{timeZone}</Text><Text style={styles.zoneAuto}>AUTO</Text></View>

          <View style={styles.heroCard}>
            <View style={styles.heroOrb} />
            <View style={styles.heroTopRow}>
              <View style={styles.liveDot} />
              <Text style={styles.heroEyebrow}>{upcoming ? 'UP NEXT' : 'A MOMENT TO REST'}</Text>
              <Text style={styles.heroSun}>✳</Text>
            </View>
            {upcoming ? (
              <>
                <View style={styles.nextTimeRow}>
                  <Text style={styles.nextTime}>{formatTime(upcoming.alarm.hour, upcoming.alarm.minute).split(' ')[0]}</Text>
                  <View style={styles.nextTimeMeta}>
                    <Text style={styles.nextMeridiem}>{formatTime(upcoming.alarm.hour, upcoming.alarm.minute).split(' ')[1]}</Text>
                    <Text style={styles.nextDate}>{relativeDate(upcoming.date, now).toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.nextLabel}>{upcoming.alarm.label || 'Alarm'}  <Text style={styles.nextDivider}>/</Text>  {repeatLabel(upcoming.alarm.days)}</Text>
                <View style={styles.heroBottom}>
                  <Text style={styles.countdown}>◷  {countdown(upcoming.date, now)}</Text>
                  <Text style={styles.heroActive}>{activeAlarms.length} ACTIVE {activeAlarms.length === 1 ? 'ALARM' : 'ALARMS'}</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.noAlarmTitle}>{ready ? 'Wake up when you’re ready.' : 'Getting things ready…'}</Text>
                <Text style={styles.noAlarmCopy}>Set a gentle reminder for your next morning.</Text>
                <Pressable onPress={openNew} style={styles.heroCta}><Text style={styles.heroCtaText}>Set your first alarm  →</Text></Pressable>
              </>
            )}
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statIcon}>◷</Text>
              <Text style={styles.statValue}>{String(activeAlarms.length).padStart(2, '0')}</Text>
              <Text style={styles.statLabel}>ACTIVE</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statIcon}>↻</Text>
              <Text style={styles.statValue}>{alarms.filter((alarm) => alarm.enabled && alarm.days?.length).length.toString().padStart(2, '0')}</Text>
              <Text style={styles.statLabel}>REPEATING</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statIcon}>☾</Text>
              <Text style={styles.statValue}>{upcoming ? formatTime(upcoming.alarm.hour, upcoming.alarm.minute).split(' ')[1] : '—'}</Text>
              <Text style={styles.statLabel}>NEXT PERIOD</Text>
            </View>
          </View>

          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.sectionTitle}>Your alarms</Text>
              <Text style={styles.sectionSub}>{alarms.length ? 'Small plans for better mornings.' : 'Build a routine that feels like yours.'}</Text>
            </View>
            <Pressable accessibilityLabel="Add alarm" style={styles.addButton} onPress={openNew}>
              <Text style={styles.addText}>＋</Text>
            </Pressable>
          </View>

          {!ready ? (
            <View style={styles.loadingCard}><Text style={styles.loadingText}>Loading your alarms…</Text></View>
          ) : alarms.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}><Text style={styles.emptyIcon}>◷</Text></View>
              <Text style={styles.emptyTitle}>A fresh start</Text>
              <Text style={styles.emptyCopy}>Set your first alarm and make a little space for tomorrow.</Text>
              <Button title="Create an alarm  →" onPress={openNew} style={styles.emptyButton} themeStyles={styles} />
            </View>
          ) : (
            <View style={styles.alarmList}>
              {alarms.slice().sort((a, b) => {
                if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
                const nextA = nextOccurrence(a, now)?.getTime() || Infinity;
                const nextB = nextOccurrence(b, now)?.getTime() || Infinity;
                return nextA - nextB;
              }).map((alarm) => {
                const occurrence = alarm.enabled ? nextOccurrence(alarm, now) : null;
                const timeParts = formatTime(alarm.hour, alarm.minute).split(' ');
                return (
                  <Pressable key={alarm.id} onPress={() => openEdit(alarm)} onLongPress={() => deleteAlarm(alarm)} style={[styles.alarmCard, !alarm.enabled && styles.alarmCardOff]}>
                    <View style={styles.cardTopline}>
                      <View style={styles.alarmIdentity}>
                        <View style={[styles.alarmMark, !alarm.enabled && styles.alarmMarkOff]}><Text style={styles.alarmMarkText}>{alarm.label?.toLowerCase().includes('work') ? '↗' : '☼'}</Text></View>
                        <View><Text style={styles.alarmTitle}>{alarm.label || 'Alarm'}</Text><Text style={styles.alarmSubtitle}>{repeatLabel(alarm.days)}</Text></View>
                      </View>
                      <Switch value={alarm.enabled} onValueChange={(value) => toggleAlarm(alarm, value)} trackColor={{ false: '#343d37', true: '#8bc49d' }} thumbColor={alarm.enabled ? '#183c29' : '#919a92'} />
                    </View>
                    <View style={styles.cardTimeRow}>
                      <Text style={[styles.alarmTime, !alarm.enabled && styles.muted]}>{timeParts[0]}</Text>
                      <Text style={[styles.alarmAmPm, !alarm.enabled && styles.muted]}>{timeParts[1]}</Text>
                      {alarm.enabled && <View style={styles.nextPill}><Text style={styles.nextPillText}>{relativeDate(occurrence, now)} · {countdown(occurrence, now)}</Text></View>}
                    </View>
                    <View style={styles.cardFooter}>
                      <View style={styles.weekRow}>{DAY_NAMES.map((day, index) => <View key={`${alarm.id}-${day}`} style={[styles.weekDay, alarm.days?.includes(index) && styles.weekDayOn]}><Text style={[styles.weekDayText, alarm.days?.includes(index) && styles.weekDayTextOn]}>{day[0]}</Text></View>)}</View>
                      <Text style={styles.editHint}>TAP TO EDIT  ·  HOLD TO DELETE</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.tipCard}>
            <View style={styles.tipIconWrap}><Text style={styles.tipIcon}>✦</Text></View>
            <View style={styles.tipContent}><Text style={styles.tipTitle}>A softer start</Text><Text style={styles.tipCopy}>A little wind-down tonight can make tomorrow feel lighter.</Text></View>
            <Text style={styles.tipArrow}>↗</Text>
          </View>
          <Text style={styles.footer}>MADE FOR SLOWER MORNINGS</Text>
        </ScrollView>
      </View>

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <View><Text style={styles.modalKicker}>MAKE IT YOURS</Text><Text style={styles.modalTitle}>{editing ? 'Edit alarm' : 'New alarm'}</Text></View>
                <Pressable accessibilityLabel="Close" onPress={() => setModal(false)} style={styles.closeButton}><Text style={styles.close}>×</Text></Pressable>
              </View>

              <View style={styles.editorSection}>
                <View style={styles.editorLabelRow}><Text style={styles.fieldLabel}>TIME</Text><Text style={styles.editorHint}>Local time</Text></View>
                <View style={styles.timeEditor}>
                  <TextInput accessibilityLabel="Hour" value={hour} onChangeText={(value) => setHour(value.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} style={styles.timeInput} />
                  <Text style={styles.timeColon}>:</Text>
                  <TextInput accessibilityLabel="Minute" value={minute} onChangeText={(value) => setMinute(value.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} style={styles.timeInput} />
                  <View style={styles.ampmStack}>{['AM', 'PM'].map((value) => <Pressable key={value} onPress={() => setAmpm(value)} style={[styles.ampmButton, ampm === value && styles.ampmSelected]}><Text style={[styles.ampmText, ampm === value && styles.ampmTextSelected]}>{value}</Text></Pressable>)}</View>
                </View>
              </View>

              <View style={styles.editorSection}>
                <View style={styles.editorLabelRow}><Text style={styles.fieldLabel}>ALARM NAME</Text><Text style={styles.editorHint}>What’s the occasion?</Text></View>
                <TextInput value={label} onChangeText={setLabel} maxLength={40} placeholder="Wake up, school, workout…" placeholderTextColor="#778078" style={styles.labelInput} />
              </View>

              <View style={styles.editorSection}>
                <View style={styles.editorLabelRow}><Text style={styles.fieldLabel}>REPEAT</Text><Text style={styles.repeatValue}>{repeatLabel(days)}</Text></View>
                <View style={styles.presetRow}>{QUICK_REPEATS.map((preset) => {
                  const selected = preset.days.length === days.length && preset.days.every((day) => days.includes(day));
                  return <Pressable key={preset.title} onPress={() => selectRepeat(preset.days)} style={[styles.presetChip, selected && styles.presetChipOn]}><Text style={[styles.presetText, selected && styles.presetTextOn]}>{preset.title}</Text></Pressable>;
                })}</View>
                <Text style={styles.customDaysTitle}>CUSTOM DAYS</Text>
                <View style={styles.dayPicker}>{DAY_NAMES.map((day, index) => <Pressable key={`${day}-${index}`} onPress={() => toggleDay(index)} style={[styles.dayPick, days.includes(index) && styles.dayPickOn]}><Text style={[styles.dayPickText, days.includes(index) && styles.dayPickTextOn]}>{day[0]}</Text></Pressable>)}</View>
              </View>

              <View style={styles.zoneInfo}><View style={styles.zoneInfoIcon}><Text style={styles.zoneInfoGlyph}>⌖</Text></View><View style={styles.zoneInfoCopy}><Text style={styles.zoneInfoTitle}>Automatic time zone</Text><Text style={styles.sheetFootnote}>Using {timeZone}. Repeating alarms follow your phone’s local time. One-time alarms update when you return to the app after a zone change.</Text></View></View>
              <View style={styles.noteCard}><Text style={styles.noteIcon}>i</Text><Text style={styles.sheetFootnote}>Allow notifications and sound for alarms to ring on this phone.</Text></View>
              <View style={styles.sheetActions}><Button title="Cancel" secondary onPress={() => setModal(false)} style={styles.halfButton} themeStyles={styles} /><Button title={saving ? 'Saving…' : 'Save alarm  →'} onPress={saveAlarm} style={styles.halfButton} themeStyles={styles} /></View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101512' },
  container: { flex: 1, backgroundColor: '#101512' },
  content: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 32 },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  brand: { color: '#f3f1e9', fontSize: 25, fontWeight: '700', letterSpacing: -1.2 },
  brandDot: { color: '#a9d7b6' },
  brandCaption: { color: '#78847b', fontSize: 8, fontWeight: '800', letterSpacing: 2.1, marginTop: 1 },
  sunBadge: { minWidth: 58, height: 42, paddingHorizontal: 9, borderRadius: 15, backgroundColor: '#202a23', borderWidth: 1, borderColor: '#354338', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  sunGlyph: { color: '#b5dcbd', fontSize: 20 },
  themeButtonLabel: { color: '#a6b2a8', fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  greeting: { color: '#f0efe8', fontSize: 28, fontWeight: '500', letterSpacing: -0.8 },
  greetingDot: { color: '#a9d7b6' },
  dateLine: { color: '#8c978f', fontSize: 12, marginTop: 4, marginBottom: 17 },
  zoneBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, backgroundColor: '#1b251e', borderWidth: 1, borderColor: '#2b392f', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, marginTop: -7, marginBottom: 14 },
  zoneDot: { color: '#9fd4ac', fontSize: 7 },
  zoneText: { color: '#a6b2a8', fontSize: 8, fontWeight: '700' },
  zoneAuto: { color: '#6b9b77', fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  heroCard: { minHeight: 204, borderRadius: 23, padding: 19, backgroundColor: '#cfe7d1', overflow: 'hidden', justifyContent: 'space-between' },
  heroOrb: { position: 'absolute', width: 182, height: 182, borderRadius: 100, top: -101, right: -26, backgroundColor: '#b9dbbf' },
  heroTopRow: { flexDirection: 'row', alignItems: 'center' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#498560', marginRight: 8 },
  heroEyebrow: { color: '#52735d', fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  heroSun: { color: '#6b9b75', marginLeft: 'auto', fontSize: 16 },
  nextTimeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 7 },
  nextTime: { color: '#183625', fontSize: 55, fontWeight: '300', letterSpacing: -3.6 },
  nextTimeMeta: { marginLeft: 9, marginTop: 4 },
  nextMeridiem: { color: '#38634a', fontSize: 12, fontWeight: '800' },
  nextDate: { color: '#68836d', fontSize: 8, fontWeight: '800', letterSpacing: 1.5, marginTop: 4 },
  nextLabel: { color: '#42654c', fontSize: 11, fontWeight: '600', marginTop: -2 },
  nextDivider: { color: '#83a58a' },
  heroBottom: { borderTopColor: '#b2d2b7', borderTopWidth: 1, paddingTop: 11, marginTop: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countdown: { color: '#2f6240', fontSize: 11, fontWeight: '800' },
  heroActive: { color: '#56745d', fontSize: 8, fontWeight: '800', letterSpacing: 1.1 },
  noAlarmTitle: { color: '#193825', fontSize: 22, lineHeight: 28, fontWeight: '500', maxWidth: 250, marginTop: 17 },
  noAlarmCopy: { color: '#55715b', fontSize: 11, marginTop: 5 },
  heroCta: { alignSelf: 'flex-start', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, backgroundColor: '#b3d8ba', marginTop: 13 },
  heroCtaText: { color: '#23432d', fontSize: 10, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 9, marginTop: 11 },
  statCard: { flex: 1, minHeight: 77, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: '#29332c', backgroundColor: '#171e19' },
  statIcon: { color: '#9ecdaa', fontSize: 12 },
  statValue: { color: '#f1f0e9', fontSize: 19, fontWeight: '500', marginTop: 2 },
  statLabel: { color: '#77847b', fontSize: 7, fontWeight: '800', letterSpacing: 1.2, marginTop: 2 },
  sectionHeading: { marginTop: 27, marginBottom: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: '#f0efe8', fontSize: 20, fontWeight: '600', letterSpacing: -0.4 },
  sectionSub: { color: '#849087', fontSize: 10, marginTop: 4 },
  addButton: { width: 39, height: 39, borderRadius: 14, backgroundColor: '#a9d7b6', alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#173526', fontSize: 24, marginTop: -3 },
  loadingCard: { padding: 18, backgroundColor: '#171e19', borderRadius: 17 },
  loadingText: { color: '#8b988e', fontSize: 11 },
  emptyCard: { borderRadius: 19, borderWidth: 1, borderColor: '#303b33', backgroundColor: '#151c17', padding: 18, alignItems: 'flex-start' },
  emptyIconWrap: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#243329', alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { color: '#abd8b6', fontSize: 19 },
  emptyTitle: { color: '#ebeee8', fontSize: 15, fontWeight: '600', marginTop: 12 },
  emptyCopy: { color: '#929c93', fontSize: 11, lineHeight: 17, marginTop: 5, maxWidth: 260 },
  button: { backgroundColor: '#a9d7b6', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#183426', fontSize: 11, fontWeight: '800' },
  buttonSecondary: { backgroundColor: '#232c25', borderWidth: 1, borderColor: '#3a463d' },
  buttonSecondaryText: { color: '#e5eae3' },
  emptyButton: { marginTop: 14 },
  alarmList: { gap: 10 },
  alarmCard: { backgroundColor: '#19211b', borderRadius: 18, paddingHorizontal: 15, paddingTop: 13, paddingBottom: 11, borderWidth: 1, borderColor: '#2a342d' },
  alarmCardOff: { backgroundColor: '#151a16', borderColor: '#242b25' },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  alarmIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alarmMark: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#2a3a2e', alignItems: 'center', justifyContent: 'center' },
  alarmMarkOff: { backgroundColor: '#252c26' },
  alarmMarkText: { color: '#b3dcbd', fontSize: 17 },
  alarmTitle: { color: '#edf0e9', fontSize: 12, fontWeight: '700' },
  alarmSubtitle: { color: '#88948a', fontSize: 9, marginTop: 3 },
  cardTimeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  alarmTime: { color: '#f2f0e9', fontSize: 38, fontWeight: '300', letterSpacing: -1.9 },
  alarmAmPm: { color: '#a8d4b3', fontSize: 10, fontWeight: '800', marginLeft: 6, marginTop: 8 },
  nextPill: { backgroundColor: '#25382b', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, marginLeft: 'auto' },
  nextPillText: { color: '#acd8b6', fontSize: 8, fontWeight: '700' },
  muted: { color: '#778078' },
  cardFooter: { borderTopWidth: 1, borderTopColor: '#2b352e', marginTop: 10, paddingTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekRow: { flexDirection: 'row', gap: 4 },
  weekDay: { width: 19, height: 19, borderRadius: 7, backgroundColor: '#252e28', alignItems: 'center', justifyContent: 'center' },
  weekDayOn: { backgroundColor: '#a9d7b6' },
  weekDayText: { color: '#707c73', fontSize: 8, fontWeight: '800' },
  weekDayTextOn: { color: '#1d3927' },
  editHint: { color: '#59665d', fontSize: 7, fontWeight: '800', letterSpacing: 0.7 },
  tipCard: { marginTop: 15, padding: 13, backgroundColor: '#19211b', borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 11, borderColor: '#2b372e', borderWidth: 1 },
  tipIconWrap: { width: 31, height: 31, borderRadius: 11, backgroundColor: '#293a2e', alignItems: 'center', justifyContent: 'center' },
  tipIcon: { color: '#b0daba', fontSize: 15 },
  tipContent: { flex: 1 },
  tipTitle: { color: '#e8eee7', fontSize: 11, fontWeight: '700' },
  tipCopy: { color: '#8d988f', fontSize: 9, lineHeight: 14, marginTop: 4 },
  tipArrow: { color: '#71967b', fontSize: 14 },
  footer: { textAlign: 'center', color: '#536057', fontSize: 8, letterSpacing: 2, marginTop: 19, marginBottom: 7 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(3,7,4,0.72)', justifyContent: 'flex-end' },
  modalSheet: { maxHeight: '93%', backgroundColor: '#171e19', paddingHorizontal: 22, paddingTop: 9, paddingBottom: 28, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: '#354238' },
  sheetHandle: { width: 36, height: 4, borderRadius: 3, backgroundColor: '#48554b', alignSelf: 'center', marginBottom: 17 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 23 },
  modalKicker: { color: '#8da393', fontSize: 8, fontWeight: '800', letterSpacing: 1.7, marginBottom: 4 },
  modalTitle: { color: '#f0f1e9', fontSize: 22, fontWeight: '600', letterSpacing: -0.4 },
  closeButton: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#242d26', alignItems: 'center', justifyContent: 'center' },
  close: { color: '#a9b3aa', fontSize: 23, lineHeight: 26 },
  editorSection: { marginBottom: 20 },
  editorLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  fieldLabel: { color: '#a3b0a5', fontSize: 8, fontWeight: '800', letterSpacing: 1.7 },
  editorHint: { color: '#69766d', fontSize: 9 },
  timeEditor: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  timeInput: { color: '#f4f2eb', fontSize: 53, fontWeight: '300', minWidth: 76, textAlign: 'center', padding: 0, borderBottomWidth: 1, borderBottomColor: '#3d4b40' },
  timeColon: { color: '#a5bbaa', fontSize: 39, marginHorizontal: 3, marginBottom: 5 },
  ampmStack: { marginLeft: 11, gap: 5 },
  ampmButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#252e28' },
  ampmSelected: { backgroundColor: '#a9d7b6' },
  ampmText: { color: '#8d998f', fontSize: 8, fontWeight: '800' },
  ampmTextSelected: { color: '#183426' },
  labelInput: { color: '#f2f1e9', backgroundColor: '#222b24', borderWidth: 1, borderColor: '#354137', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, fontSize: 11 },
  repeatValue: { color: '#a9d7b6', fontSize: 9, fontWeight: '700' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  presetChip: { backgroundColor: '#232c25', borderColor: '#364238', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  presetChipOn: { backgroundColor: '#2f4835', borderColor: '#618a69' },
  presetText: { color: '#a0aaa1', fontSize: 9, fontWeight: '700' },
  presetTextOn: { color: '#c5e4cb' },
  customDaysTitle: { color: '#738076', fontSize: 8, fontWeight: '800', letterSpacing: 1.3, marginTop: 15, marginBottom: 9 },
  dayPicker: { flexDirection: 'row', justifyContent: 'space-between' },
  dayPick: { width: 37, height: 37, borderRadius: 13, backgroundColor: '#242d26', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#354137' },
  dayPickOn: { backgroundColor: '#a9d7b6', borderColor: '#a9d7b6' },
  dayPickText: { color: '#929d93', fontSize: 10, fontWeight: '800' },
  dayPickTextOn: { color: '#203b2b' },
  noteCard: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#202a23', borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10, marginBottom: 16 },
  noteIcon: { width: 16, height: 16, borderRadius: 8, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', color: '#b4d9bc', backgroundColor: '#35463a', fontSize: 10, fontWeight: '800' },
  sheetFootnote: { flex: 1, color: '#9aa59b', fontSize: 8, lineHeight: 13 },
  zoneInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#202a23', borderColor: '#334137', borderWidth: 1, borderRadius: 13, padding: 11, marginBottom: 9 },
  zoneInfoIcon: { width: 29, height: 29, borderRadius: 10, backgroundColor: '#334638', alignItems: 'center', justifyContent: 'center' },
  zoneInfoGlyph: { color: '#b3dabb', fontSize: 16 },
  zoneInfoCopy: { flex: 1 },
  zoneInfoTitle: { color: '#dce8dd', fontSize: 9, fontWeight: '800', marginBottom: 3 },
  sheetActions: { flexDirection: 'row', gap: 9, paddingBottom: 3 },
  halfButton: { flex: 1 },
});

const LIGHT_SURFACES = {
  '#101512': '#f4f7f3', '#151a16': '#eef2ed', '#151c17': '#ffffff', '#171e19': '#ffffff',
  '#19211b': '#ffffff', '#1b251e': '#edf3ee', '#202a23': '#edf3ee', '#222b24': '#f7f9f6',
  '#232c25': '#f1f5f0', '#242b25': '#eef2ed', '#242d26': '#eef2ed', '#252c26': '#edf2ed',
  '#252e28': '#e8efe9', '#25382b': '#e0eee2', '#29332c': '#e4eae4', '#293a2e': '#e0ece2',
  '#2a342d': '#dfe7df', '#2a3a2e': '#e0ece2', '#2b352e': '#e2e9e2', '#2b372e': '#e1e9e1',
  '#2b392f': '#e1e9e1', '#2f4835': '#d8eadb', '#303b33': '#dfe7df', '#334137': '#d8e2d8',
  '#334638': '#dceadd', '#343d37': '#dce4dc', '#354137': '#d8e2d8', '#354238': '#d8e2d8',
  '#354338': '#d8e2d8', '#35463a': '#d9e8dc', '#364238': '#d9e3d9', '#3a463d': '#d9e2da',
  '#3d4b40': '#d6e1d7',
};

const LIGHT_TEXT = {
  '#f0efe8': '#1e2c21', '#f0f1e9': '#1e2c21', '#f1f0e9': '#1e2c21', '#f2f0e9': '#1e2c21',
  '#f2f1e9': '#1e2c21', '#f3f1e9': '#1e2c21', '#f4f2eb': '#1e2c21', '#edf0e9': '#1e2c21',
  '#ebeee8': '#243329', '#e8eee7': '#243329', '#e5eae3': '#26372b', '#dce8dd': '#2b3d30',
  '#a8d4b3': '#467451', '#a9d7b6': '#467451', '#abd8b6': '#467451', '#acd8b6': '#467451',
  '#b0daba': '#467451', '#b3dabb': '#467451', '#b3dcbd': '#467451', '#b4d9bc': '#467451',
  '#b5dcbd': '#467451', '#c5e4cb': '#365b3e', '#a6b2a8': '#637269', '#a9b3aa': '#637269',
  '#a3b0a5': '#637269', '#a0aaa1': '#65736a', '#9aa59b': '#647267', '#929c93': '#66746a',
  '#929d93': '#66746a', '#919a92': '#66746a', '#8d988f': '#68766c', '#8d998f': '#68766c',
  '#8c978f': '#68766c', '#8b988e': '#68766c', '#88948a': '#68766c', '#849087': '#68766c',
  '#78847b': '#657269', '#77847b': '#657269', '#778078': '#657269', '#738076': '#657269',
  '#69766d': '#657269', '#59665d': '#657269', '#536057': '#657269', '#52735d': '#477152',
  '#55715b': '#477152', '#56745d': '#477152', '#42654c': '#477152', '#38634a': '#477152',
  '#2f6240': '#356b46', '#23432d': '#23432d',
};

const LIGHT_BORDERS = {
  '#29332c': '#e0e7df', '#2a342d': '#e0e7df', '#2b352e': '#e0e7df', '#2b372e': '#e0e7df',
  '#2b392f': '#e0e7df', '#303b33': '#dce5dc', '#334137': '#d9e3d9', '#334638': '#d9e3d9',
  '#343d37': '#dce5dc', '#354137': '#d9e3d9', '#354238': '#d9e3d9', '#354338': '#d9e3d9',
  '#35463a': '#d9e3d9', '#364238': '#d9e3d9', '#3a463d': '#d6e0d7', '#3d4b40': '#d6e0d7',
};

function makeThemeStyles(sourceStyles, darkMode) {
  if (darkMode) return sourceStyles;
  const stylesForLightMode = {};
  Object.keys(sourceStyles).forEach((key) => {
    const source = StyleSheet.flatten(sourceStyles[key]);
    stylesForLightMode[key] = {
      ...source,
      ...(source.backgroundColor && LIGHT_SURFACES[source.backgroundColor.toLowerCase()]
        ? { backgroundColor: LIGHT_SURFACES[source.backgroundColor.toLowerCase()] } : {}),
      ...(source.color && LIGHT_TEXT[source.color.toLowerCase()]
        ? { color: LIGHT_TEXT[source.color.toLowerCase()] } : {}),
      ...(source.borderColor && LIGHT_BORDERS[source.borderColor.toLowerCase()]
        ? { borderColor: LIGHT_BORDERS[source.borderColor.toLowerCase()] } : {}),
    };
  });
  return StyleSheet.create(stylesForLightMode);
}
