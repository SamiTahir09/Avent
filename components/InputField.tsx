import {
  TextInput,
  View,
  Text,
  Image,
} from "react-native";

import { InputFieldProps } from "@/types/type";

const InputField = ({
  label,
  icon,
  secureTextEntry = false,
  labelStyle,
  containerStyle,
  inputStyle,
  iconStyle,
  className,
  ...props
}: InputFieldProps) => {
  return (
    <View className="my-2 w-full">
      <Text className={`text-xl font-outfit-medium mb-3 ${labelStyle}`}>
        {label}
      </Text>
      <View
        className={`flex flex-row justify-start items-center relative bg-neutral-100 rounded-full border border-neutral-100 focus:border-primary-500  ${containerStyle}`}
      >
        {icon && (
          <Image source={icon} className={`w-6 h-6 ml-4 ${iconStyle}`} />
        )}
        <TextInput
          className={`rounded-full p-4 font-outfit-medium text-black text-[15px] flex-1 ${inputStyle} text-left placeholder:text-neutral-500`}
          secureTextEntry={secureTextEntry}
          {...props}
        />
      </View>
    </View>
  );
};

export default InputField;
