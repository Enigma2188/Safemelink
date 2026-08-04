import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  Line,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

const NETWORK_NODES = [
  [24, 208, 2.2], [52, 165, 1.4], [79, 229, 2.8], [108, 184, 1.8],
  [139, 245, 2.5], [169, 173, 1.5], [194, 224, 2.2], [225, 161, 1.7],
  [252, 231, 2.9], [280, 183, 1.4], [315, 247, 2.4], [352, 196, 1.8],
  [372, 269, 2.6], [31, 315, 1.7], [67, 342, 2.5], [101, 291, 1.4],
  [137, 363, 2.8], [171, 312, 1.7], [218, 346, 2.6], [258, 293, 1.5],
  [303, 361, 2.8], [343, 318, 1.6], [18, 418, 2.3], [57, 448, 1.5],
  [99, 407, 2.5], [145, 468, 1.8], [191, 401, 2.8], [238, 464, 1.5],
  [286, 411, 2.6], [337, 462, 1.7], [377, 404, 2.2], [35, 532, 1.8],
  [82, 570, 2.6], [128, 520, 1.4], [177, 588, 2.8], [225, 523, 1.7],
  [271, 579, 2.5], [321, 530, 1.6], [366, 574, 2.8], [48, 651, 2.3],
  [105, 626, 1.5], [157, 679, 2.7], [211, 628, 1.8], [263, 682, 2.5],
  [318, 641, 1.5], [355, 700, 2.7],
] as const;

const NETWORK_LINES = [
  [24, 208, 79, 229], [52, 165, 108, 184], [79, 229, 139, 245],
  [108, 184, 169, 173], [108, 184, 139, 245], [139, 245, 194, 224],
  [169, 173, 225, 161], [194, 224, 252, 231], [225, 161, 280, 183],
  [252, 231, 315, 247], [280, 183, 352, 196], [315, 247, 372, 269],
  [31, 315, 79, 229], [31, 315, 67, 342], [67, 342, 101, 291],
  [101, 291, 139, 245], [101, 291, 137, 363], [137, 363, 171, 312],
  [171, 312, 194, 224], [171, 312, 218, 346], [218, 346, 258, 293],
  [258, 293, 315, 247], [258, 293, 303, 361], [303, 361, 343, 318],
  [343, 318, 372, 269], [18, 418, 67, 342], [18, 418, 57, 448],
  [57, 448, 99, 407], [99, 407, 137, 363], [99, 407, 145, 468],
  [145, 468, 191, 401], [191, 401, 218, 346], [191, 401, 238, 464],
  [238, 464, 286, 411], [286, 411, 303, 361], [286, 411, 337, 462],
  [337, 462, 377, 404], [35, 532, 57, 448], [35, 532, 82, 570],
  [82, 570, 128, 520], [128, 520, 145, 468], [128, 520, 177, 588],
  [177, 588, 225, 523], [225, 523, 238, 464], [225, 523, 271, 579],
  [271, 579, 321, 530], [321, 530, 337, 462], [321, 530, 366, 574],
  [48, 651, 82, 570], [48, 651, 105, 626], [105, 626, 157, 679],
  [157, 679, 177, 588], [157, 679, 211, 628], [211, 628, 263, 682],
  [263, 682, 271, 579], [263, 682, 318, 641], [318, 641, 366, 574],
  [318, 641, 355, 700],
] as const;

const RADAR_RINGS = [76, 104, 134, 166, 202, 240] as const;

function NetworkLayer({ highlight = false }: { highlight?: boolean }) {
  return (
    <Svg
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 390 844"
      width="100%">
      {!highlight ? (
        <>
          <Defs>
            <RadialGradient id="blueNebula" cx="23%" cy="23%" r="55%">
              <Stop offset="0" stopColor="#008CFF" stopOpacity="0.34" />
              <Stop offset="0.32" stopColor="#064DBE" stopOpacity="0.16" />
              <Stop offset="1" stopColor="#050816" stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id="violetNebula" cx="28%" cy="68%" r="46%">
              <Stop offset="0" stopColor="#8B3DFF" stopOpacity="0.3" />
              <Stop offset="0.35" stopColor="#4722B8" stopOpacity="0.14" />
              <Stop offset="1" stopColor="#050816" stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#00D4FF" stopOpacity="0.16" />
              <Stop offset="0.5" stopColor="#1167D9" stopOpacity="0.08" />
              <Stop offset="1" stopColor="#050816" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect fill="#050816" height="844" width="390" />
          <Rect fill="url(#blueNebula)" height="520" width="390" x="-70" y="20" />
          <Rect fill="url(#violetNebula)" height="520" width="390" x="-80" y="330" />
          <Ellipse cx="195" cy="440" fill="url(#coreGlow)" rx="240" ry="310" />
          {RADAR_RINGS.map((radius, index) => (
            <Circle
              key={radius}
              cx="195"
              cy="438"
              fill="none"
              opacity={0.1 + index * 0.012}
              r={radius}
              stroke={index % 2 === 0 ? '#00BFFF' : '#3E75FF'}
              strokeWidth="0.8"
            />
          ))}
          <Ellipse
            cx="195"
            cy="438"
            fill="none"
            opacity="0.12"
            rx="186"
            ry="250"
            stroke="#4C8DFF"
            strokeWidth="0.8"
          />
          <Ellipse
            cx="195"
            cy="438"
            fill="none"
            opacity="0.08"
            rx="128"
            ry="255"
            stroke="#7C3AED"
            strokeWidth="0.7"
          />
        </>
      ) : null}

      {NETWORK_LINES.map(([x1, y1, x2, y2], index) => (
        <Line
          key={`line-${index}`}
          opacity={highlight ? 0.18 : 0.13}
          stroke={index % 7 === 0 ? '#8B5CF6' : '#168BFF'}
          strokeWidth={highlight ? 0.75 : 0.55}
          x1={x1}
          x2={x2}
          y1={y1}
          y2={y2}
        />
      ))}
      {NETWORK_NODES.map(([cx, cy, radius], index) => (
        <Circle
          key={`node-${index}`}
          cx={cx}
          cy={cy}
          fill={index % 9 === 0 ? '#A855F7' : index % 4 === 0 ? '#00D4FF' : '#4BA6FF'}
          opacity={highlight ? 0.82 : 0.58}
          r={highlight ? radius * 0.72 : radius}
        />
      ))}
    </Svg>
  );
}

export function SafeNetworkBackground() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 6_000,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 6_000,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const pulseStyle = {
    opacity: pulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.2, 0.48],
    }),
  };

  return (
    <View pointerEvents="none" style={styles.container}>
      <NetworkLayer />
      <Animated.View style={[styles.highlightLayer, pulseStyle]}>
        <NetworkLayer highlight />
      </Animated.View>
      <View style={styles.topShade} />
      <View style={styles.bottomShade} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050816',
    overflow: 'hidden',
  },
  highlightLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  topShade: {
    backgroundColor: 'rgba(2, 5, 16, 0.34)',
    height: '15%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  bottomShade: {
    backgroundColor: 'rgba(2, 5, 16, 0.3)',
    bottom: 0,
    height: '18%',
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
