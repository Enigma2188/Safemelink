import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, ScrollView, TextInput, type ScrollViewProps, type TextInputProps } from 'react-native';

const FocusContext = createContext<(input: TextInput | null) => void>(() => {});
const CLEARANCE = 16;

export function keyboardScrollDelta(inputY: number, inputHeight: number, viewportY: number, viewportHeight: number, keyboardY: number) {
  const bottom = Math.min(viewportY + viewportHeight, keyboardY) - CLEARANCE;
  return inputY + inputHeight > bottom ? inputY + inputHeight - bottom
    : inputY < viewportY + CLEARANCE ? inputY - viewportY - CLEARANCE : 0;
}

// Android keeps native resize. Extra content space is not a second viewport resize.
// iOS keeps the screen's existing KeyboardAvoidingView/automatic insets.
export function KeyboardSafeScrollView({ children, contentContainerStyle, onLayout, onScroll, ...props }: ScrollViewProps) {
  const scroll = useRef<ScrollView>(null);
  const focused = useRef<TextInput | null>(null);
  const offset = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const mounted = useRef(true);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const reveal = useCallback(() => {
    if (Platform.OS !== 'android') return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const input = focused.current;
      const container = scroll.current;
      if (!input || !container || keyboardTop.current === null) return;
      container.getNativeScrollRef()?.measureInWindow((_x, scrollY, _width, height) => {
        input.measureInWindow((_inputX, inputY, _inputWidth, inputHeight) => {
          if (!mounted.current || focused.current !== input || keyboardTop.current === null) return;
          const delta = keyboardScrollDelta(inputY, inputHeight, scrollY, height, keyboardTop.current);
          if (delta !== 0) container.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
        });
      });
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (Platform.OS !== 'android') return;
    const metrics = Keyboard.metrics();
    if (metrics) {
      keyboardTop.current = metrics.screenY;
      setKeyboardHeight(metrics.height);
    }
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      setKeyboardHeight(0);
    });
    return () => {
      mounted.current = false;
      show.remove();
      hide.remove();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const focus = useCallback((input: TextInput | null) => {
    focused.current = input;
    if (input) reveal();
  }, [reveal]);

  return (
    <FocusContext.Provider value={focus}>
      <ScrollView
        {...props}
        ref={scroll}
        scrollEventThrottle={16}
        onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }}
        onLayout={(event) => { setViewportHeight(event.nativeEvent.layout.height); onLayout?.(event); reveal(); }}
        onContentSizeChange={(width, height) => { props.onContentSizeChange?.(width, height); reveal(); }}
        contentContainerStyle={[contentContainerStyle, Platform.OS === 'android' && keyboardHeight > 0
          ? { minHeight: viewportHeight + keyboardHeight + CLEARANCE, paddingBottom: keyboardHeight + CLEARANCE }
          : undefined]}>
        {children}
      </ScrollView>
    </FocusContext.Provider>
  );
}

export function KeyboardSafeTextInput({ onFocus, onBlur, ...props }: TextInputProps) {
  const input = useRef<TextInput>(null);
  const focus = useContext(FocusContext);
  return <TextInput {...props} ref={input}
    onFocus={(event) => { focus(input.current); onFocus?.(event); }}
    onBlur={(event) => { focus(null); onBlur?.(event); }} />;
}
