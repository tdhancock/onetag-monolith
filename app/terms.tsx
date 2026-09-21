

import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TermsOfServiceScreen() {
  return (
    <SafeAreaView className="flex-1 bg-black">
      <Stack.Screen 
        options={{ 
          headerShown: true, 
          title: 'Terms of Service',
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
        }} 
      />
      
      <ScrollView className="flex-1 px-6 py-6">
        <Text className="text-white text-2xl font-bold mb-4">Terms of Service</Text>
        <Text className="text-gray-400 text-base mb-4 leading-6">
          Last Updated: April 4, 2026
        </Text>
        <Text className="text-gray-300 text-base mb-6 leading-7">
          By using OneTag, you agree to these terms. Please read them carefully.
        </Text>
        <Text className="text-white text-lg font-bold mb-3">1. Using our Services</Text>
        <Text className="text-gray-400 text-base mb-6 leading-7">
          You must follow any policies made available to you within the Services. Do not misuse our Services. For example, do not interfere with our Services or try to access them using a method other than the interface and the instructions that we provide.
        </Text>
        <Text className="text-white text-lg font-bold mb-3 mt-6">Intellectual Property</Text>
        <Text className="text-gray-400 text-base mb-3 leading-7">
          © 2026 OneTag. All rights reserved.
        </Text>
        <Text className="text-gray-400 text-base mb-3 leading-7">
          The source code is licensed under the Apache License, Version 2.0. You may use, reproduce, and distribute it in accordance with the license terms available at http://www.apache.org/licenses/LICENSE-2.0
        </Text>
        <Text className="text-gray-500 text-sm mb-6 leading-6">
          Source code: github.com/sametyilmaztemel/onetag-monolith
        </Text>
        <View className="pb-10" />
      </ScrollView>
    </SafeAreaView>
  );
}
