import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { recordError } from "@/services/Crashlytics";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors that would otherwise unmount the whole app to a
 * blank/white screen with nothing in Crashlytics. Doesn't catch errors from
 * event handlers or async code — those go through try/catch + recordError()
 * at the call site, or the global handler in services/Crashlytics.ts.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    recordError(error, `React render error: ${info.componentStack?.slice(0, 200)}`);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView className="p-6 h-full flex flex-col items-center justify-center bg-white">
          <Text className="font-outfit-bold text-3xl text-center text-red-500">
            Something went wrong
          </Text>
          <Text className="font-outfit-medium text-lg text-center mt-4 text-gray-600">
            The app hit an unexpected error. Please try again.
          </Text>

          <TouchableOpacity
            onPress={this.reset}
            className="bg-purple-600 rounded-full px-8 py-4 mt-10"
          >
            <Text className="font-outfit-bold text-white text-lg">Try Again</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}
