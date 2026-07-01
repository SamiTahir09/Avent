import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

type InteractiveOpeningLogoProps = {
    onFinish: () => void;
};

export default function InteractiveOpeningLogo({ onFinish }: InteractiveOpeningLogoProps) {
    const scale = useRef(new Animated.Value(0.9)).current;
    const rotate = useRef(new Animated.Value(-8)).current;
    const translateY = useRef(new Animated.Value(24)).current;
    const glow = useRef(new Animated.Value(0.6)).current;
    const float = useRef(new Animated.Value(0)).current;
    const ringScale = useRef(new Animated.Value(0.92)).current;
    const shine = useRef(new Animated.Value(-140)).current;
    const buttonOpacity = useRef(new Animated.Value(0)).current;
    const textOpacity = useRef(new Animated.Value(0.7)).current;
    const [pressed, setPressed] = useState(false);
    const hasFinishedRef = useRef(false);
    const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const buttonRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pressAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

    useEffect(() => {
        const finish = () => {
            if (hasFinishedRef.current) {
                return;
            }

            hasFinishedRef.current = true;

            if (autoAdvanceTimerRef.current) {
                clearTimeout(autoAdvanceTimerRef.current);
                autoAdvanceTimerRef.current = null;
            }

            if (pressTimerRef.current) {
                clearTimeout(pressTimerRef.current);
                pressTimerRef.current = null;
            }

            if (buttonRevealTimerRef.current) {
                clearTimeout(buttonRevealTimerRef.current);
                buttonRevealTimerRef.current = null;
            }

            pressAnimationRef.current?.stop();
            onFinish();
        };

        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(glow, {
                    toValue: 1,
                    duration: 14000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(glow, {
                    toValue: 0.6,
                    duration: 14000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );

        const floatLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(float, {
                    toValue: -8,
                    duration: 3200,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(float, {
                    toValue: 8,
                    duration: 3200,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );

        const ringLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(ringScale, {
                    toValue: 1.12,
                    duration: 2800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(ringScale, {
                    toValue: 0.92,
                    duration: 2800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );

        const shineLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(shine, {
                    toValue: 260,
                    duration: 4600,
                    easing: Easing.linear,
                    useNativeDriver: true,
                }),
                Animated.timing(shine, {
                    toValue: -140,
                    duration: 0,
                    useNativeDriver: true,
                }),
            ])
        );

        const buttonLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(buttonOpacity, {
                    toValue: 1,
                    duration: 1400,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(buttonOpacity, {
                    toValue: 0.82,
                    duration: 1400,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );

        const textLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(textOpacity, {
                    toValue: 1,
                    duration: 1600,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(textOpacity, {
                    toValue: 0.75,
                    duration: 1600,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );

        Animated.parallel([
            Animated.spring(scale, {
                toValue: 1,
                friction: 10,
                tension: 42,
                useNativeDriver: true,
            }),
            Animated.timing(rotate, {
                toValue: 0,
                duration: 1100,
                easing: Easing.out(Easing.exp),
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: 0,
                duration: 1100,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
        ]).start();

        pulseLoop.start();
        floatLoop.start();
        ringLoop.start();
        shineLoop.start();
        textLoop.start();

        buttonRevealTimerRef.current = setTimeout(() => {
            if (hasFinishedRef.current) {
                return;
            }

            Animated.timing(buttonOpacity, {
                toValue: 1,
                duration: 1200,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
            }).start();
            buttonLoop.start();
        }, 2500);

        autoAdvanceTimerRef.current = setTimeout(() => {
            finish();
        }, 9500);

        return () => {
            if (autoAdvanceTimerRef.current) {
                clearTimeout(autoAdvanceTimerRef.current);
            }

            if (pressTimerRef.current) {
                clearTimeout(pressTimerRef.current);
            }

            if (buttonRevealTimerRef.current) {
                clearTimeout(buttonRevealTimerRef.current);
            }

            pulseLoop.stop();
            floatLoop.stop();
            ringLoop.stop();
            shineLoop.stop();
            buttonLoop.stop();
            textLoop.stop();
            pressAnimationRef.current?.stop();
        };
    }, [buttonOpacity, float, glow, onFinish, ringScale, rotate, scale, shine, textOpacity, translateY]);

    const handlePress = () => {
        if (pressed || hasFinishedRef.current) {
            return;
        }

        setPressed(true);

        if (autoAdvanceTimerRef.current) {
            clearTimeout(autoAdvanceTimerRef.current);
            autoAdvanceTimerRef.current = null;
        }

        if (buttonRevealTimerRef.current) {
            clearTimeout(buttonRevealTimerRef.current);
            buttonRevealTimerRef.current = null;
        }

        pressAnimationRef.current = Animated.parallel([
            Animated.sequence([
                Animated.spring(scale, {
                    toValue: 1.08,
                    friction: 5,
                    tension: 80,
                    useNativeDriver: true,
                }),
                Animated.spring(scale, {
                    toValue: 1,
                    friction: 6,
                    tension: 70,
                    useNativeDriver: true,
                }),
            ]),
            Animated.timing(buttonOpacity, {
                toValue: 1,
                duration: 220,
                useNativeDriver: true,
            }),
            Animated.timing(textOpacity, {
                toValue: 1,
                duration: 220,
                useNativeDriver: true,
            }),
        ]);

        pressAnimationRef.current.start(() => {
            pressTimerRef.current = setTimeout(() => {
                if (!hasFinishedRef.current) {
                    hasFinishedRef.current = true;
                    onFinish();
                }
            }, 2000);
        });
    };

    return (
        <LinearGradient
            colors={["#7c3aed", "#2563eb", "#06b6d4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="flex-1"
        >
            <View className="flex-1 items-center justify-center overflow-hidden px-8">
                <Animated.View
                    style={{
                        transform: [{ translateY: float }],
                        opacity: 0.3,
                    }}
                    className="absolute left-6 top-20 h-24 w-24 rounded-full border border-white/20"
                />
                <Animated.View
                    style={{
                        transform: [{ translateY: float.interpolate({ inputRange: [-8, 8], outputRange: [10, -10] }) }],
                        opacity: 0.22,
                    }}
                    className="absolute bottom-20 right-8 h-32 w-32 rounded-full border border-white/20"
                />

                <Animated.View
                    style={{
                        transform: [{ scale }, { rotate: rotate.interpolate({ inputRange: [-8, 0], outputRange: ["-8deg", "0deg"] }) }, { translateY }],
                    }}
                    className="items-center"
                >
                    <Animated.View
                        style={{
                            transform: [{ scale: ringScale }],
                            shadowColor: "#ffffff",
                            shadowOpacity: glow,
                            shadowRadius: 24,
                            shadowOffset: { width: 0, height: 0 },
                        }}
                        className="relative h-32 w-32 items-center justify-center rounded-full border-[6px] border-white/80 bg-white/20"
                    >
                        <Animated.View
                            style={{
                                transform: [{ translateX: shine }],
                            }}
                            className="absolute h-40 w-3 rounded-full bg-white/30"
                        />
                        <Text className="text-5xl">✈️</Text>
                    </Animated.View>

                    <Animated.Text
                        style={{ opacity: textOpacity }}
                        className="mt-6 text-4xl font-bold tracking-[2px] text-white"
                    >
                        AVENT
                    </Animated.Text>
                    <Animated.Text
                        style={{ opacity: textOpacity }}
                        className="mt-2 text-center text-base text-white/80"
                    >
                        Plan smarter, travel lighter
                    </Animated.Text>
                </Animated.View>

                <Animated.View style={{ opacity: buttonOpacity }}>
                    <Pressable
                        disabled={pressed}
                        onPress={handlePress}
                        className="mt-10 rounded-full border border-white/30 bg-white/15 px-6 py-3"
                    >
                        <Text className="text-base font-semibold text-white">
                            {pressed ? "Opening..." : "Tap to enter"}
                        </Text>
                    </Pressable>
                </Animated.View>
            </View>
        </LinearGradient>
    );
}
