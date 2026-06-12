import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Dimensions,
  Platform,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

const { width, height } = Dimensions.get('window');

// Set notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

type Alarm = {
  id: number;
  time: string;
  period: string;
  days: string[];
  label: string;
  color: string;
  enabled: boolean;
  deleteAfterOff: boolean;
  vibrate: boolean;
  repeat: string;
  notificationIds: string[];
};

type MathQuestion = {
  question: string;
  answer: string;
};

const AlarmApp = () => {
  const [currentScreen, setCurrentScreen] = useState<'main' | 'add' | 'ringing'>('main');
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const now = new Date();
  const [newAlarm, setNewAlarm] = useState({
    hour: now.getHours() % 12 || 12,
    minute: now.getMinutes(),
    period: now.getHours() >= 12 ? 'PM' : 'AM',
    repeat: 'once',
    ringtone: 'Default',
    vibrate: true,
    deleteAfterOff: true,
    label: '',
    color: 'blue',
    date: now,
    days: [] as string[],
  });
  const [ringingAlarm, setRingingAlarm] = useState<Alarm | null>(null);
  const [quizQuestion, setQuizQuestion] = useState<MathQuestion | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [isAnswerCorrect, setIsAnswerCorrect] = useState<boolean | null>(null);

  const colors = ['blue', 'red', 'green', 'yellow', 'purple', 'pink'];
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const mathQuestions: MathQuestion[] = [
    { question: 'What is 15 + 27?', answer: '42' },
    { question: 'What is 8 × 7?', answer: '56' },
    { question: 'What is 100 - 37?', answer: '63' },
    { question: 'What is 144 ÷ 12?', answer: '12' },
    { question: 'What is 23 + 19?', answer: '42' },
  ];

  // Request notification permissions
  useEffect(() => {
    const registerForPushNotificationsAsync = async () => {
      if (!Device.isDevice) {
        console.warn('Must use a physical device for push notifications');
        return false;
      }
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowSound: true, allowBadge: true },
        });
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        console.warn('Notification permissions not granted');
        return false;
      }
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      }
      return true;
    };
    registerForPushNotificationsAsync().then((result) => {
      if (result) {
        console.log('Notification permissions granted');
      }
    });
  }, []);

  // Load alarms from AsyncStorage
  useEffect(() => {
    const loadAlarms = async () => {
      try {
        const storedAlarms = await AsyncStorage.getItem('alarms');
        if (storedAlarms) {
          const parsedAlarms: Alarm[] = JSON.parse(storedAlarms);
          // Migrate and validate days
          const validatedAlarms = parsedAlarms.map((alarm) => {
            let days: string[] = ['Everyday'];
            if (Array.isArray(alarm.days)) {
              // Filter valid days
              days = alarm.days.filter((day) =>
                daysOfWeek.includes(day) || day === 'Everyday'
              );
              if (days.length === 0) days = ['Everyday'];
            } else if (typeof alarm.days === 'string') {
              // Convert string to array
              days = alarm.days === 'Everyday' ? ['Everyday'] : [alarm.days].filter((day) =>
                daysOfWeek.includes(day)
              );
              if (days.length === 0) days = ['Everyday'];
            }
            return {
              ...alarm,
              days,
              notificationIds: Array.isArray(alarm.notificationIds) ? alarm.notificationIds : [],
            };
          });
          const sortedAlarms = validatedAlarms.sort((a, b) =>
            getNextAlarmTimestamp(a) - getNextAlarmTimestamp(b)
          );
          setAlarms(sortedAlarms);
          await Notifications.cancelAllScheduledNotificationsAsync();
          sortedAlarms.forEach((alarm) => {
            if (alarm.enabled) {
              scheduleAlarmNotification(alarm);
            }
          });
        }
      } catch (error) {
        console.error('Error loading alarms:', error);
      }
    };
    loadAlarms();
  }, []);

  // Save alarms to AsyncStorage and reschedule notifications
  useEffect(() => {
    const saveAlarms = async () => {
      try {
        await AsyncStorage.setItem('alarms', JSON.stringify(alarms));
        await Notifications.cancelAllScheduledNotificationsAsync();
        alarms.forEach((alarm) => {
          if (alarm.enabled) {
            scheduleAlarmNotification(alarm);
          }
        });
      } catch (error) {
        console.error('Error saving alarms:', error);
      }
    };
    if (alarms.length > 0) {
      saveAlarms();
    }
  }, [alarms]);

  // Handle notifications after alarms are loaded
  useEffect(() => {
    if (alarms.length === 0) return;

    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const alarmId = notification.request.content.data.alarmId;
      const alarm = alarms.find((a) => a.id === alarmId);
      if (alarm && alarm.enabled) {
        console.log(`Handling notification for alarm ID ${alarmId}`);
        setQuizQuestion(mathQuestions[Math.floor(Math.random() * mathQuestions.length)]);
        setRingingAlarm(alarm);
        setCurrentScreen('ringing');
        setUserAnswer('');
        setIsAnswerCorrect(null);
        if (alarm.deleteAfterOff) {
          setAlarms((prevAlarms) =>
            prevAlarms
              .map((a) => (a.id === alarm.id ? { ...a, enabled: false } : a))
              .sort((a, b) => getNextAlarmTimestamp(a) - getNextAlarmTimestamp(b))
          );
        }
      } else {
        console.warn(`Alarm with ID ${alarmId} not found or not enabled`);
        Notifications.cancelScheduledNotificationAsync(notification.request.identifier);
      }
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const alarmId = response.notification.request.content.data.alarmId;
      const alarm = alarms.find((a) => a.id === alarmId);
      if (alarm && alarm.enabled) {
        console.log(`Handling notification response for alarm ID ${alarmId}`);
        setQuizQuestion(mathQuestions[Math.floor(Math.random() * mathQuestions.length)]);
        setRingingAlarm(alarm);
        setCurrentScreen('ringing');
        setUserAnswer('');
        setIsAnswerCorrect(null);
        if (alarm.deleteAfterOff) {
          setAlarms((prevAlarms) =>
            prevAlarms
              .map((a) => (a.id === alarm.id ? { ...a, enabled: false } : a))
              .sort((a, b) => getNextAlarmTimestamp(a) - getNextAlarmTimestamp(b))
          );
        }
      } else {
        console.warn(`Alarm with ID ${alarmId} not found or not enabled`);
        Notifications.cancelScheduledNotificationAsync(response.notification.request.identifier);
      }
    });

    return () => {
      subscription.remove();
      responseSubscription.remove();
    };
  }, [alarms]);

  const getNextAlarmTimestamp = (alarm: Alarm) => {
    const now = new Date();
    const [hours, minutes] = alarm.time.split(':').map(Number);
    let alarmHours = hours;
    if (alarm.period.toLowerCase() === 'pm' && hours !== 12) alarmHours += 12;
    if (alarm.period.toLowerCase() === 'am' && hours === 12) alarmHours = 0;

    const alarmDate = new Date(now);
    alarmDate.setHours(alarmHours, minutes, 0, 0);

    // Adjust for specific days
    if (alarm.days.length > 0 && alarm.repeat !== 'once' && !alarm.days.includes('Everyday')) {
      let daysUntilNext = 7;
      const today = now.getDay();
      for (const day of alarm.days) {
        const dayIndex = daysOfWeek.indexOf(day);
        if (dayIndex === -1) continue; // Skip invalid days
        let diff = (dayIndex - today + 7) % 7;
        if (diff === 0 && alarmDate <= now) diff = 7;
        daysUntilNext = Math.min(daysUntilNext, diff);
      }
      alarmDate.setDate(now.getDate() + daysUntilNext);
    } else if (alarmDate <= now) {
      alarmDate.setDate(alarmDate.getDate() + 1);
    }

    return alarmDate.getTime();
  };

  const scheduleAlarmNotification = async (alarm: Alarm) => {
    console.log(alarm.time)
    console.log(alarm.time)
    console.log(alarm.time)
    console.log(alarm.time)
    console.log(alarm.time)
    const [hours, minutes] = alarm.time.split(':').map(Number);
    let alarmHours = hours;
    if (alarm.period.toLowerCase() === 'pm' && hours !== 12) alarmHours += 12;
    if (alarm.period.toLowerCase() === 'am' && hours === 12) alarmHours = 0;
    console.log("++++++++++")
    console.log(alarmHours)
    console.log(alarmHours)
    console.log(alarmHours)
    const notificationIds: string[] = [];

    if (alarm.repeat === 'once') {
      const alarmDate = new Date();
      console.log(alarmHours)
      alarmDate.setHours(alarmHours, minutes, 0, 0);
      if (alarmDate <= new Date()) {
        alarmDate.setDate(alarmDate.getDate() + 1);
      }
      console.log(`Scheduling one-time alarm for ${alarmDate}`);
      console.log(alarmDate)
      console.log(alarmDate)
      console.log(alarmDate)
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: alarm.label || 'Wake up !!!',
          body: 'Time to wake up!',
          sound: 'default',
          vibrate: alarm.vibrate ? [0, 500, 1000] : undefined,
          data: { alarmId: alarm.id },
        },
        // @ts-ignore
        trigger: {
          date: alarmDate,
          repeats: false,
        },
      });
      notificationIds.push(notificationId);
    } else if (alarm.days.length > 0 && !alarm.days.includes('Everyday')) {
      // Schedule for each valid day
      for (const day of alarm.days) {
        if (!daysOfWeek.includes(day)) {
          console.warn(`Invalid day "${day}" in alarm ID ${alarm.id}, skipping`);
          continue;
        }
        const now = new Date();
        const alarmDate = new Date(now);
        alarmDate.setHours(alarmHours, minutes, 0, 0);
        const targetDayIndex = daysOfWeek.indexOf(day);
        const currentDayIndex = now.getDay();
        let daysUntilNext = (targetDayIndex - currentDayIndex + 7) % 7;
        if (daysUntilNext === 0 && alarmDate <= now) daysUntilNext = 7;
        alarmDate.setDate(now.getDate() + daysUntilNext);
        console.log(`Scheduling weekly alarm for ${day} at ${alarmDate}`);
        const notificationId = await Notifications.scheduleNotificationAsync({
          content: {
            title: alarm.label || 'Wake up !!!',
            body: 'Time to wake up!',
            sound: 'default',
            vibrate: alarm.vibrate ? [0, 500, 1000] : undefined,
            data: { alarmId: alarm.id },
          },
          trigger: {
            hour: alarmHours,
            minute: minutes,
            weekday: targetDayIndex + 1,
            repeats: true,
          },
        });
        notificationIds.push(notificationId);
      }
    } else {
      // Daily alarm
      const alarmDate = new Date();
      alarmDate.setHours(alarmHours, minutes, 0, 0);
      if (alarmDate <= new Date()) {
        alarmDate.setDate(alarmDate.getDate() + 1);
      }
      console.log(`Scheduling daily alarm for ${alarmDate}`);
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: alarm.label || 'Wake up !!!',
          body: 'Time to wake up!',
          sound: 'default',
          vibrate: alarm.vibrate ? [0, 500, 1000] : undefined,
          data: { alarmId: alarm.id },
        },
        trigger: {
          hour: alarmHours,
          minute: minutes,
          repeats: true,
        },
      });
      notificationIds.push(notificationId);
    }

    setAlarms((prevAlarms) =>
      prevAlarms.map((a) =>
        a.id === alarm.id ? { ...a, notificationIds } : a
      )
    );
  };

  const generateRandomQuestion = () => {
    return mathQuestions[Math.floor(Math.random() * mathQuestions.length)];
  };

  const handleAnswerSubmit = () => {
    if (userAnswer.trim() === quizQuestion?.answer) {
      setIsAnswerCorrect(true);
      setTimeout(() => {
        setCurrentScreen('main');
        setRingingAlarm(null);
        setQuizQuestion(null);
        setUserAnswer('');
        setIsAnswerCorrect(null);
        if (ringingAlarm?.notificationIds) {
          ringingAlarm.notificationIds.forEach((id) =>
            Notifications.cancelScheduledNotificationAsync(id)
          );
        }
      }, 1000);
    } else {
      setIsAnswerCorrect(false);
      setTimeout(() => {
        setIsAnswerCorrect(null);
        setUserAnswer('');
      }, 1000);
    }
  };

  const toggleAlarm = (id: number) => {
    setAlarms((prevAlarms) => {
      const updatedAlarms = prevAlarms
        .map((alarm) => (alarm.id === id ? { ...alarm, enabled: !alarm.enabled } : alarm))
        .sort((a, b) => getNextAlarmTimestamp(a) - getNextAlarmTimestamp(b));
      Notifications.cancelAllScheduledNotificationsAsync().then(() => {
        updatedAlarms.forEach((alarm) => {
          if (alarm.enabled) {
            scheduleAlarmNotification(alarm);
          }
        });
      });
      return updatedAlarms;
    });
  };

  const getColorValue = (color: string) => {
    const colorMap: { [key: string]: string } = {
      blue: '#3B82F6',
      red: '#EF4444',
      green: '#10B981',
      yellow: '#F59E0B',
      purple: '#8B5CF6',
      pink: '#EC4899',
    };
    return colorMap[color] || colorMap.blue;
  };

  const saveAlarm = () => {
    const newId = alarms.length > 0 ? Math.max(...alarms.map((a) => a.id)) + 1 : 1;
    console.log("*******************")
    console.log(newAlarm)
    const alarm: Alarm = {
      id: newId,
      time: `${String(newAlarm.hour).padStart(2, '0')}:${String(newAlarm.minute).padStart(2, '0')}`,
      period: newAlarm.period.toLowerCase(),
      days: newAlarm.days.length > 0 ? newAlarm.days.filter((day) => daysOfWeek.includes(day)) : ['Everyday'],
      label: newAlarm.label || 'Wake up !!!',
      color: newAlarm.color,
      enabled: true,
      deleteAfterOff: newAlarm.deleteAfterOff,
      vibrate: newAlarm.vibrate,
      repeat: newAlarm.repeat,
      notificationIds: [],
    };
    const updatedAlarms = [...alarms, alarm].sort((a, b) =>
      getNextAlarmTimestamp(a) - getNextAlarmTimestamp(b)
    );
    setAlarms(updatedAlarms);
    setCurrentScreen('main');
    scheduleAlarmNotification(alarm);
    const now = new Date();
    setNewAlarm({
      hour: now.getHours() % 12 || 12,
      minute: now.getMinutes(),
      period: now.getHours() >= 12 ? 'PM' : 'AM',
      repeat: 'once',
      ringtone: 'Default',
      vibrate: true,
      deleteAfterOff: true,
      label: '',
      color: 'blue',
      date: now,
      days: [],
    });
    setShowDatePicker(false);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    const currentDate = selectedDate || newAlarm.date;
    setShowDatePicker(Platform.OS === 'ios');
    const hours = currentDate.getHours();
    const minutes = currentDate.getMinutes();
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    setNewAlarm({
      ...newAlarm,
      hour: hour12,
      minute: minutes,
      period: period,
      date: currentDate,
    });
  };

  const toggleDay = (day: string) => {
    setNewAlarm((prev) => {
      const days = prev.days.includes(day)
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day];
      return { ...prev, days };
    });
  };

  type ToggleSwitchProps = {
    value: boolean;
    onValueChange: () => void;
    color?: string;
  };

  const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ value, onValueChange, color = '#3B82F6' }) => (
    <TouchableOpacity
      style={[styles.toggleContainer, { backgroundColor: value ? color : '#D1D5DB' }]}
      onPress={onValueChange}
      activeOpacity={0.8}
    >
      <View style={[styles.toggleCircle, { transform: [{ translateX: value ? 24 : 2 }] }]} />
    </TouchableOpacity>
  );

  const ArrowLeft = () => <Text style={styles.icon}>←</Text>;

  const Check = ({ size = 24, color = '#FFFFFF' }) => (
    <Text style={[styles.icon, { fontSize: size, color }]}>✓</Text>
  );

  const X = ({ size = 24, color = '#FFFFFF' }) => (
    <Text style={[styles.icon, { fontSize: size, color }]}>✗</Text>
  );

  if (currentScreen === 'main') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#4F46E5" />
        <View style={styles.header}>
          <View style={styles.headerBackground}>
            <Text style={styles.backgroundZ1}>Z</Text>
            <Text style={styles.backgroundZ2}>Z</Text>
            <Text style={styles.backgroundZ3}>Z</Text>
          </View>
          <View style={styles.headerContent}>
            <View style={styles.statusDots}>
              <View style={styles.dot} />
              <View style={styles.longDot} />
              <View style={styles.dot} />
            </View>
            <Text style={styles.headerTitle}>Alarm</Text>
            <Text style={styles.headerSubtitle}>Active alarms</Text>
          </View>
        </View>
        <ScrollView style={styles.content}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Saved Alarms</Text>
            <View style={styles.menuDots}>
              <View style={styles.menuDot} />
              <View style={styles.menuDot} />
              <View style={styles.menuDot} />
            </View>
          </View>
          <View style={styles.alarmsList}>
            {alarms.map((alarm) => (
              <View key={alarm.id} style={styles.alarmItem}>
                <View style={[styles.alarmColorBar, { backgroundColor: getColorValue(alarm.color) }]} />
                <View style={styles.alarmInfo}>
                  <View style={styles.timeContainer}>
                    <Text style={styles.alarmTime}>{alarm.time}</Text>
                    <Text style={styles.alarmPeriod}>{alarm.period}</Text>
                  </View>
                  <Text style={styles.alarmDays}>
                    {Array.isArray(alarm.days) ? alarm.days.join(', ') : 'Everyday'}
                  </Text>
                  <Text style={styles.alarmLabel}>{alarm.label}</Text>
                </View>
                <View style={styles.alarmControls}>
                  <TouchableOpacity
                    onPress={() => {
                      const question = generateRandomQuestion();
                      setQuizQuestion(question);
                      setRingingAlarm(alarm);
                      setCurrentScreen('ringing');
                      setUserAnswer('');
                      setIsAnswerCorrect(null);
                    }}
                    style={styles.testButton}
                  >
                    <Text style={styles.testButtonText}>Test</Text>
                  </TouchableOpacity>
                  <ToggleSwitch
                    value={alarm.enabled}
                    onValueChange={() => toggleAlarm(alarm.id)}
                    color={getColorValue(alarm.color)}
                  />
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
        <View style={styles.addButtonContainer}>
          <TouchableOpacity onPress={() => setCurrentScreen('add')} style={styles.addButton}>
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (currentScreen === 'add') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#4F46E5" />
        <View style={styles.header}>
          <View style={styles.headerBackground}>
            <Text style={styles.backgroundZ1}>Z</Text>
            <Text style={styles.backgroundZ2}>Z</Text>
            <Text style={styles.backgroundZ3}>Z</Text>
          </View>
          <View style={styles.headerContent}>
            <View style={styles.statusDots}>
              <View style={styles.dot} />
              <View style={styles.longDot} />
              <View style={styles.dot} />
            </View>
            <View style={styles.headerWithBack}>
              <TouchableOpacity onPress={() => setCurrentScreen('main')} style={styles.backButton}>
                <ArrowLeft />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Add alarms</Text>
            </View>
          </View>
        </View>
        <View style={styles.timePicker}>
          <TouchableOpacity style={styles.timeDisplay} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.timeMain}>
              {String(newAlarm.hour).padStart(2, '0')}:{String(newAlarm.minute).padStart(2, '0')} {newAlarm.period}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={newAlarm.date}
              mode="time"
              is24Hour={false}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onDateChange}
            />
          )}
        </View>
        <ScrollView style={styles.settingsContainer}>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Repeat</Text>
            <Text style={styles.settingValue}>{newAlarm.repeat}</Text>
          </View>
          <View style={styles.settingItemColumn}>
            <Text style={styles.settingLabel}>Days</Text>
            <View style={styles.dayPicker}>
              {daysOfWeek.map((day) => (
                <TouchableOpacity
                  key={day}
                  onPress={() => toggleDay(day)}
                  style={[
                    styles.dayButton,
                    newAlarm.days.includes(day) && styles.dayButtonSelected,
                  ]}
                >
                  <Text style={styles.dayButtonText}>{day.slice(0, 3)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Ringtone</Text>
            <Text style={styles.settingValue}>{newAlarm.ringtone}</Text>
          </View>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Vibrate alarm sounds</Text>
            <ToggleSwitch
              value={newAlarm.vibrate}
              onValueChange={() => setNewAlarm({ ...newAlarm, vibrate: !newAlarm.vibrate })}
            />
          </View>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Delete after off</Text>
            <ToggleSwitch
              value={newAlarm.deleteAfterOff}
              onValueChange={() => setNewAlarm({ ...newAlarm, deleteAfterOff: !newAlarm.deleteAfterOff })}
            />
          </View>
          <View style={styles.settingItemColumn}>
            <Text style={styles.settingLabel}>Label</Text>
            <TextInput
              value={newAlarm.label}
              onChangeText={(text) => setNewAlarm({ ...newAlarm, label: text })}
              style={styles.labelInput}
              placeholder="Wake up !!!"
              placeholderTextColor="#9CA3AF"
            />
          </View>
          <View style={styles.settingItemColumn}>
            <Text style={styles.settingLabel}>Select color</Text>
            <View style={styles.colorPicker}>
              {colors.map((color) => (
                <TouchableOpacity
                  key={color}
                  onPress={() => setNewAlarm({ ...newAlarm, color })}
                  style={[styles.colorButton, { backgroundColor: getColorValue(color) }, newAlarm.color === color && styles.colorButtonSelected]}
                />
              ))}
              <View style={styles.colorMore}>
                <Text style={styles.colorMoreText}>...</Text>
              </View>
            </View>
          </View>
        </ScrollView>
        <View style={styles.addButtonContainer}>
          <TouchableOpacity onPress={saveAlarm} style={styles.addButton}>
            <Text style={styles.addButtonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (currentScreen === 'ringing') {
    return (
      <View style={styles.ringingContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#4F46E5" />
        <View style={styles.floatingZs}>
          <Text style={styles.floatingZ1}>Z</Text>
          <Text style={styles.floatingZ2}>Z</Text>
          <Text style={styles.floatingZ3}>Z</Text>
          <Text style={styles.floatingZ4}>Z</Text>
          <Text style={styles.floatingZ5}>Z</Text>
        </View>
        <View style={styles.ringingContent}>
          <View style={styles.statusDots}>
            <View style={styles.dot} />
            <View style={styles.longDot} />
            <View style={styles.dot} />
          </View>
          <View style={styles.ringingTimeDisplay}>
            <Text style={styles.ringingTime}>{ringingAlarm?.time}</Text>
            <Text style={styles.ringingPeriod}>{ringingAlarm?.period.toUpperCase()}</Text>
            <Text style={styles.ringingDays}>
              {Array.isArray(ringingAlarm?.days) ? ringingAlarm.days.join(', ') : 'Everyday'}
            </Text>
            <Text style={styles.ringingLabel}>{ringingAlarm?.label}</Text>
          </View>
          <View style={styles.quizContainer}>
            <Text style={styles.quizTitle}>Solve to turn off alarm:</Text>
            <Text style={styles.quizQuestion}>{quizQuestion?.question}</Text>
            <View style={styles.answerContainer}>
              <TextInput
                value={userAnswer}
                onChangeText={setUserAnswer}
                style={styles.answerInput}
                placeholder="Your answer"
                placeholderTextColor="rgba(255, 255, 255, 0.7)"
                keyboardType="numeric"
                onSubmitEditing={handleAnswerSubmit}
              />
              <TouchableOpacity onPress={handleAnswerSubmit} style={styles.submitButton}>
                <Check size={24} />
              </TouchableOpacity>
            </View>
            {isAnswerCorrect === true && (
              <View style={styles.feedbackContainer}>
                <Check size={20} color="#86EFAC" />
                <Text style={styles.correctText}>Correct! Turning off alarm...</Text>
              </View>
            )}
            {isAnswerCorrect === false && (
              <View style={styles.feedbackContainer}>
                <X size={20} color="#FCA5A5" />
                <Text style={styles.wrongText}>Wrong answer! Try again.</Text>
              </View>
            )}
          </View>
          <View style={styles.checkmarkContainer}>
            <View style={styles.checkmarkInner}>
              <Check size={32} color="#4F46E5" />
            </View>
          </View>
        </View>
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    height: 160,
    position: 'relative',
    overflow: 'hidden',
  },
  headerBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#4F46E5',
    background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
  },
  backgroundZ1: {
    position: 'absolute',
    top: -32,
    right: -32,
    fontSize: 128,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.3)',
  },
  backgroundZ2: {
    position: 'absolute',
    top: 32,
    right: 48,
    fontSize: 96,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.2)',
  },
  backgroundZ3: {
    position: 'absolute',
    top: 128,
    right: 80,
    fontSize: 64,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.1)',
  },
  headerContent: {
    flex: 1,
    padding: 24,
    paddingTop: 40,
    zIndex: 10,
  },
  statusDots: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    marginRight: 4,
  },
  longDot: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    marginRight: 4,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  headerWithBack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 16,
    padding: 8,
  },
  icon: {
    fontSize: 24,
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
    padding: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  menuDots: {
    flexDirection: 'row',
  },
  menuDot: {
    width: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#9CA3AF',
    marginLeft: 4,
  },
  alarmsList: {
    gap: 16,
  },
  alarmItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
  },
  alarmColorBar: {
    width: 4,
    height: 64,
    borderRadius: 2,
    marginRight: 16,
  },
  alarmInfo: {
    flex: 1,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  alarmTime: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginRight: 4,
  },
  alarmPeriod: {
    fontSize: 14,
    color: '#6B7280',
  },
  alarmDays: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  alarmLabel: {
    fontSize: 14,
    color: '#4B5563',
    marginTop: 4,
  },
  alarmControls: {
    alignItems: 'center',
    gap: 8,
  },
  testButton: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  testButtonText: {
    fontSize: 12,
    color: '#2563EB',
  },
  toggleContainer: {
    width: 48,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    position: 'relative',
  },
  toggleCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  addButtonContainer: {
    padding: 24,
  },
  addButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  timePicker: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
  },
  timeDisplay: {
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
  },
  timeMain: {
    fontSize: 48,
    fontWeight: '300',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  settingsContainer: {
    flex: 1,
    padding: 24,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  settingItemColumn: {
    paddingVertical: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: '#374151',
  },
  settingValue: {
    fontSize: 16,
    color: '#6B7280',
  },
  labelInput: {
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    paddingVertical: 8,
    fontSize: 16,
    color: '#1F2937',
    marginTop: 8,
  },
  colorPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  colorButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  colorButtonSelected: {
    borderWidth: 2,
    borderColor: '#9CA3AF',
  },
  colorMore: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorMoreText: {
    fontSize: 12,
    color: '#6B7280',
  },
  dayPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  dayButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    marginRight: 8,
    marginBottom: 8,
  },
  dayButtonSelected: {
    backgroundColor: '#4F46E5',
  },
  dayButtonText: {
    fontSize: 14,
    color: '#374151',
  },
  ringingContainer: {
    flex: 1,
    backgroundColor: '#4F46E5',
    position: 'relative',
  },
  floatingZs: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  floatingZ1: {
    position: 'absolute',
    top: -32,
    right: -32,
    fontSize: 144,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.2)',
  },
  floatingZ2: {
    position: 'absolute',
    top: 64,
    right: 48,
    fontSize: 112,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.15)',
  },
  floatingZ3: {
    position: 'absolute',
    top: 128,
    right: 80,
    fontSize: 80,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.1)',
  },
  floatingZ4: {
    position: 'absolute',
    bottom: -16,
    left: -16,
    fontSize: 96,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.15)',
  },
  floatingZ5: {
    position: 'absolute',
    bottom: 64,
    left: 32,
    fontSize: 64,
    fontWeight: 'bold',
    color: 'rgba(255, 255, 255, 0.1)',
  },
  ringingContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    zIndex: 10,
  },
  ringingTimeDisplay: {
    alignItems: 'center',
    marginBottom: 32,
  },
  ringingTime: {
    fontSize: 112,
    fontWeight: '300',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  ringingPeriod: {
    fontSize: 20,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  ringingDays: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 8,
  },
  ringingLabel: {
    fontSize: 18,
    color: '#FFFFFF',
    marginTop: 16,
  },
  quizContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    marginBottom: 32,
  },
  quizTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
  },
  quizQuestion: {
    fontSize: 24,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 24,
  },
  answerContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  answerInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    color: '#FFFFFF',
    fontSize: 20,
    textAlign: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    marginRight: 8,
  },
  submitButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  feedbackContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  correctText: {
    color: '#86EFAC',
    fontWeight: '600',
    marginLeft: 8,
  },
  wrongText: {
    color: '#FCA5A5',
    fontWeight: '600',
    marginLeft: 8,
  },
  checkmarkContainer: {
    width: 80,
    height: 80,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkInner: {
    width: 48,
    height: 48,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AlarmApp;