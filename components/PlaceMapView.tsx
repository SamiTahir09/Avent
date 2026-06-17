import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Dimensions, ActivityIndicator, TouchableOpacity, FlatList } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import GooglePlacesService from "../services/GooglePlaces";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface NearbyItem {
    placeId: string;
    name: string;
    address?: string;
    rating?: number;
    lat: number;
    lng: number;
    photo?: string;
}

interface Props {
    lat: number;
    lng: number;
    name?: string;
    apiKey?: string;
    onClose?: () => void;
}

const PlaceMapView: React.FC<Props> = ({ lat, lng, name, apiKey, onClose }) => {
    const [nearby, setNearby] = useState<NearbyItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [satellite, setSatellite] = useState(false);
    const [region, setRegion] = useState(() => ({
        latitude: Number(lat) || 0,
        longitude: Number(lng) || 0,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
    }));

    useEffect(() => {
        const nLat = Number(lat);
        const nLng = Number(lng);
        if (!isFinite(nLat) || !isFinite(nLng)) return;
        setRegion({ latitude: nLat, longitude: nLng, latitudeDelta: 0.01, longitudeDelta: 0.01 });

        (async () => {
            if (!apiKey) return setLoading(false);
            setLoading(true);
            try {
                const types = ["lodging", "restaurant", "tourist_attraction", "cafe", "museum", "park"];
                const all: NearbyItem[] = [];
                for (const t of types) {
                    const res = await GooglePlacesService.getNearbyPlaces(lat, lng, apiKey, t, 2000, 5);
                    res.forEach((r: any) => all.push(r));
                }
                setNearby(all);
            } catch (e) {
                // ignore
            } finally {
                setLoading(false);
            }
        })();
    }, [lat, lng, apiKey]);

    return (
        <View style={styles.container}>
            {isFinite(region.latitude) && isFinite(region.longitude) ? (
                <MapView
                    provider={PROVIDER_GOOGLE}
                    style={styles.map}
                    region={region}
                    onRegionChangeComplete={(r) => setRegion(r)}
                    mapType={satellite ? "satellite" : "standard"}
                >
                    <Marker coordinate={{ latitude: region.latitude, longitude: region.longitude }} title={name || "Location"} />
                    {nearby.map((n) => (
                        <Marker
                            key={n.placeId}
                            coordinate={{ latitude: n.lat, longitude: n.lng }}
                            title={n.name}
                            description={n.address}
                        />
                    ))}
                </MapView>
            ) : (
                <View style={[styles.map, { alignItems: "center", justifyContent: "center" }]}>
                    <Text>Location unavailable</Text>
                </View>
            )}
                {nearby.map((n) => (
                    <Marker
                        key={n.placeId}
                        coordinate={{ latitude: n.lat, longitude: n.lng }}
                        title={n.name}
                        description={n.address}
                    />
                ))}
            </MapView>

            <View style={styles.controls}>
                <TouchableOpacity onPress={() => setSatellite((s) => !s)} style={styles.controlBtn}>
                    <Text style={styles.controlText}>{satellite ? "Standard" : "Satellite"}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} style={[styles.controlBtn, { backgroundColor: "#ef4444" }]}>
                    <Text style={[styles.controlText, { color: "#fff" }]}>Close</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.listContainer}>
                <Text style={styles.listTitle}>Nearby</Text>
                {loading ? (
                    <ActivityIndicator />
                ) : (
                    <FlatList
                        data={nearby}
                        keyExtractor={(i) => i.placeId}
                        renderItem={({ item }) => (
                            <View style={styles.listItem}>
                                <Text style={styles.itemTitle}>{item.name}</Text>
                                <Text style={styles.itemSub}>{item.address}</Text>
                            </View>
                        )}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                    />
                )}
            </View>
        </View >
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    map: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.6 },
    controls: { position: "absolute", top: 10, right: 10, flexDirection: "row", gap: 8 },
    controlBtn: { backgroundColor: "#fff", padding: 8, borderRadius: 8, marginLeft: 8 },
    controlText: { color: "#111", fontFamily: "outfit-medium" },
    listContainer: { padding: 12, backgroundColor: "transparent" },
    listTitle: { fontFamily: "outfit-bold", fontSize: 16, marginBottom: 8 },
    listItem: { width: 220, padding: 8, backgroundColor: "#fff", borderRadius: 8, marginRight: 8 },
    itemTitle: { fontFamily: "outfit-medium" },
    itemSub: { fontFamily: "outfit", fontSize: 12, color: "#6b7280" },
});

export default PlaceMapView;
