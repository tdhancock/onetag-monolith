import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import {
  checkUsernameExists,
  CreateProfileError,
  useCreateProfile,
  useCurrentProfile,
  useMyProfilesQuery,
} from '../features/profiles';
import { cleanHtml } from '../lib/cleanHtml';
import { USERNAME_CHECK_DEBOUNCE_MS, type UsernameAvailability } from '../lib/screens/auth';
import {
  createProfileFormValid,
  createProfileTitle,
  HANDLE_TAKEN_MESSAGE,
  missingProfileKinds,
  profileKindLabel,
  profileNameLabel,
  usernameError as usernameRuleError,
  type ProfileKind,
} from '../lib/screens/profile';
import { Button, EmptyState, MonoLabel, TextField } from '../components/native/ui';
import KeyboardAvoider from '../components/native/KeyboardAvoider';
import UsernameStatus from '../components/native/UsernameStatus';
import { color, space, type } from '../theme/tokens';

/**
 * Add a second profile to the account (ONE-26) — in practice a Business
 * Profile, since signup already made the Individual one and an account holds
 * at most one of each.
 *
 * Reached from the switcher's "Add a Profile". It offers only the kinds the
 * account lacks, and with both already held it says so rather than letting
 * the one-of-each index refuse an insert. On success the new profile becomes
 * the one being acted as, and the Profile tab shows it.
 */
export default function CreateProfileScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { authUserId } = useCurrentProfile();
  const { data: profiles, isPending } = useMyProfilesQuery(authUserId);
  const createProfile = useCreateProfile();

  const missing = profiles ? missingProfileKinds(profiles) : [];
  const [chosenKind, setChosenKind] = useState<ProfileKind | null>(null);
  const kind: ProfileKind | undefined = chosenKind && missing.includes(chosenKind) ? chosenKind : missing[0];

  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameAvailability>('idle');
  // The database's word on the handle, after the live check said it was free.
  const [takenOnSubmit, setTakenOnSubmit] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');

  const ruleError = usernameRuleError(username);

  const handleUsernameChange = (value: string) => {
    // Handles are lowercase, as sign-up makes them.
    setUsername(value.toLowerCase());
    setTakenOnSubmit(false);
  };

  // Look the handle up once typing pauses, so "Taken" shows before the form
  // is sent — sign-up's check, against the same global index. The account's
  // own other profile counts: handles are unique across both kinds.
  useEffect(() => {
    if (!username || ruleError) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const taken = await checkUsernameExists(username);
        if (!cancelled) setUsernameStatus(taken ? 'taken' : 'available');
      } catch {
        if (!cancelled) setUsernameStatus('unknown');
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, ruleError]);

  const handleError = ruleError ?? (takenOnSubmit || usernameStatus === 'taken' ? HANDLE_TAKEN_MESSAGE : null);
  const canCreate =
    Boolean(kind) &&
    !takenOnSubmit &&
    !createProfile.isPending &&
    createProfileFormValid({ username, usernameError: ruleError, usernameStatus, name });

  const handleCreate = async () => {
    if (!kind || !canCreate) return;
    try {
      const created = await createProfile.mutateAsync({
        profileType: kind,
        username,
        fullName: name.trim(),
        bio: bio.trim() ? cleanHtml(bio.trim()) : null,
      });
      addToast(`You're now acting as @${created.username}.`, 'success');
      // Back to the Profile tab, which now shows the new profile.
      router.dismissTo('/(tabs)/profile');
    } catch (error) {
      if (error instanceof CreateProfileError && error.reason === 'handle-taken') {
        // Claimed between the check and the insert: said on the field, as
        // the live check would have.
        setTakenOnSubmit(true);
        return;
      }
      addToast(
        error instanceof CreateProfileError && error.reason === 'kind-taken'
          ? `You already have a ${kind} profile.`
          : 'Could not create the profile. Please try again.',
        'error',
      );
    }
  };

  const header = (title: string) => (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12} style={styles.headerSide}>
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerSide} />
    </View>
  );

  if (isPending || !profiles) {
    return (
      <SafeAreaView style={styles.screen}>
        {header('New profile')}
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  // Both kinds held: nothing can be added, so nothing is attempted.
  if (!kind) {
    return (
      <SafeAreaView style={styles.screen}>
        {header('New profile')}
        <EmptyState
          title="You have both profiles"
          body="An account holds one Individual and one Business Profile. Switch between them from your profile."
          action={{ label: 'Back', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  return (
    // A modal, declared in app/_layout.tsx.
    <SafeAreaView style={styles.screen}>
      {header(createProfileTitle(kind))}

      <KeyboardAvoider style={styles.fill}>
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          {missing.length > 1 ? (
            <View style={styles.kinds} accessibilityRole="radiogroup">
              {missing.map(option => (
                <Button
                  key={option}
                  variant={option === kind ? 'primary' : 'outline'}
                  size="sm"
                  onPress={() => setChosenKind(option)}
                  accessibilityLabel={`${option === 'business' ? 'Business' : 'Individual'} profile${option === kind ? ', selected' : ''}`}
                  style={styles.kind}
                >
                  {option === 'business' ? 'Business' : 'Individual'}
                </Button>
              ))}
            </View>
          ) : (
            <MonoLabel color="textMid">{`${profileKindLabel(kind)} PROFILE`}</MonoLabel>
          )}

          <Text style={styles.intro}>
            {kind === 'business'
              ? 'A separate presence for your business, with its own handle, posts and followers. Add its category, website and location afterwards from Edit profile.'
              : 'A separate personal presence, with its own handle, posts and followers.'}
          </Text>

          <View style={styles.fields}>
            <TextField
              label="Username"
              value={username}
              onChangeText={handleUsernameChange}
              placeholder="Pick a handle"
              autoCapitalize="none"
              autoCorrect={false}
              error={handleError}
              trailing={<UsernameStatus status={takenOnSubmit ? 'taken' : usernameStatus} />}
              accessibilityLabel="Username"
            />
            <TextField
              label={profileNameLabel(kind)}
              value={name}
              onChangeText={setName}
              placeholder={kind === 'business' ? 'Your business' : 'Your name'}
              autoCapitalize="words"
              accessibilityLabel={profileNameLabel(kind)}
            />
            <TextField
              label="Bio"
              value={bio}
              onChangeText={setBio}
              placeholder="Optional"
              multiline
              inputStyle={styles.bio}
              accessibilityLabel="Bio"
            />
          </View>

          <Button fullWidth onPress={handleCreate} loading={createProfile.isPending} disabled={!canCreate} style={styles.create}>
            Create profile
          </Button>
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  fill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  headerSide: {
    minWidth: 64,
  },
  cancel: {
    fontFamily: type.body,
    fontSize: 16,
    color: color.text,
  },
  title: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  loading: {
    marginTop: space.xxl,
  },
  scroll: {
    padding: space.lg,
    paddingBottom: space.xxl,
  },
  kinds: {
    flexDirection: 'row',
    gap: space.sm,
  },
  kind: {
    flex: 1,
  },
  intro: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
  fields: {
    marginTop: space.xl,
    gap: space.lg,
  },
  bio: {
    minHeight: 90,
  },
  create: {
    marginTop: space.xl,
  },
});
