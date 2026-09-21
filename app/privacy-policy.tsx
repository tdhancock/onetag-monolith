

import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-black">
      <Stack.Screen 
        options={{ 
          headerShown: true, 
          title: 'Privacy Policy',
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
        }} 
      />
      
      <ScrollView className="flex-1 px-6 py-6">
        <Text className="text-white text-2xl font-bold mb-4">Privacy Policy</Text>
        <Text className="text-gray-400 text-base mb-4 leading-6">
          Last Updated: April 4, 2026
        </Text>
        <Text className="text-gray-300 text-base mb-6 leading-7">
          At OneTag, we take your privacy seriously. This policy describes how we collect, use, and share your personal information when you use our mobile application.
        </Text>
        <Text className="text-white text-lg font-bold mb-3">1. Information We Collect</Text>
        <Text className="text-gray-400 text-base mb-6 leading-7">
          We collect information you provide directly to us, such as when you create or modify your account, request on-demand services, contact customer support, or otherwise communicate with us.
        </Text>
        <Text className="text-white text-lg font-bold mb-3 mt-6">Copyright Notice</Text>
        <Text className="text-gray-400 text-base mb-3 leading-7">
          © 2026 OneTag. All rights reserved.
        </Text>
        <Text className="text-gray-400 text-base mb-3 leading-7">
          Licensed under the Apache License, Version 2.0. You may obtain a copy of the license at http://www.apache.org/licenses/LICENSE-2.0
        </Text>
        <Text className="text-gray-500 text-sm mb-6 leading-6">
          Source code available at: github.com/sametyilmaztemel/onetag-monolith
        </Text>
        <View className="pb-10" />
      </ScrollView>
    </SafeAreaView>
  );
}
