const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const log = require('../../util/log');
const cast = require('../../util/cast');
const formatMessage = require('format-message');
const BLE = require('../../io/ble');
const Base64Util = require('../../util/base64-util');

/// rename: MicroBit -> MBitUART
/// chage UUID
/// add Tuch logo
/// add Maqueen Patrol

/**
 * Icon png to be displayed at the left edge of each extension block, encoded as a data URI.
 * @type {string}
 */
// eslint-disable-next-line max-len
const blockIconURI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAIvSURBVFhHzZa/q7FhGMcpJRKlmEyMLBZlUwa9gyTKj2IxyKIMFovwFxiY1XusBmVWFmWllIF/wSCD5X67uHmfH9/3OM97nlPXtz6Dz33u73Wdo+fpWH7/+mANlJyAkhNQcgJKTkDJCSg5ASUnoOQElJyAkhNQalmtViKTyQibzSYsFsu38Hq9otlsCjQHAaUSt9sNB5lBNpt9uyiUxGazgaU/AZr/BEpCW0I4nU6Ry+VEsVgUhULBEOVyWSSTSV0n4XK5/rkklOhr3e12wqwMh0Ndf6fTgUvqxHw+V120Wq2y1tzs93vVHEK7C6ETiURCdelwOMhK89NqtVSzptOpbknVh7tQXPD7/bLqb9LptEilUvLT1zIajUQgEBCDwUCaR263m2rBUqlkbMFqtSqrHonH46+zUCgk7ec5Ho+vOwS9U5VRnkWjUWMLVioVWfMI/UWfZ3a7XdrPo31dLRYLefKI8iwcDhtbMBgMyppHTqfT68zIU91oNO53tL8w5dlH5PP59wvGYjHVpfP5LKvMT7/fV82aTCbvF6QfUl7yeDyyztxcLhfVHEK7C6ETd6m56PP5xPV6ldXfz3K5VPUTtVrt6wtut1tdAUFPWbvdFr1eT3S7XUPQ11mv14XD4YDdaA8CSmI2m8GinwDNfwLlE3pSUaFZ0FsCzVUCpZbxeCwikQgc8j/Q/4Hr9frtcgSUnICSE1ByAkpOQMkJKDkBJSeg5ASUnICSE1Dy4cPyB0nQT/SpjaweAAAAAElFTkSuQmCC';

/**
 * Enum for micro:bit BLE command protocol.
 * https://github.com/LLK/scratch-microbit-firmware/blob/master/protocol.md
 * @readonly
 * @enum {number}
 */
const CMD = {
	//PIN_CONFIG: "DP",
	DISPLAY_TEXT: "CT",
	DISPLAY_LED: "CM",
	SENSOR: "RM",
	MAGNETIC_FORCE: "RF",
	ACCELERATION: "RG",
	ROTATION: "RR",
	MICROPHONE: "RP",
	PLAY_TONE_16: "TX",
	PLAY_TONE_8: "T8",
	PLAY_TONE_4: "T4",
	PLAY_TONE_2: "T2",
	PLAY_TONE_1: "T1",
	MODE_PIN_0: "R0",
	MODE_PIN_1: "R1",
	MODE_PIN_2: "R2",
	WRITE_PIN_0: "P0",
	WRITE_PIN_1: "P1",
	WRITE_PIN_2: "P2",
	PLAY_EXPRESS: "TT",
};

/**
 * A time interval to wait (in milliseconds) while a block that sends a BLE message is running.
 * @type {number}
 */
const BLESendInterval = 100;


/**
 * Manage communication with a MBitUART peripheral over a Scrath Link client socket.
 */
class MBitUART {

	/**
	* Construct a MicroBit communication object.
	* @param {Runtime} runtime - the Scratch 3.0 runtime
	* @param {string} extensionId - the id of the extension
	*/
	constructor (runtime, extensionId) {

		/**
		* The Scratch 3.0 runtime used to trigger the green flag button.
		* @type {Runtime}
		* @private
		*/
		this._runtime = runtime;

		/**
		* The id of the extension this peripheral belongs to.
		*/
		this._extensionId = extensionId;

		if( this._runtime._mbitlink == undefined) {
			this._runtime._mbitlink = { instance: null, extensions: { mbituart : this } };
		} else {
			this._runtime._mbitlink.extensions.mbituart = this;
		}

		/**
		* The most recently received value for each sensor.
		* @type {Object.<string, number>}
		* @private
		*/
		this._sensors = {
			buttonA: 0,
			buttonB: 0,

			// micro:bit v2	
			touchLogo: 0,

			touch_pins: [0, 0, 0],
			gestureState: "",
			ledMatrixState: new Uint8Array(5),
            light_level: 0,
			temperature: 0,
            magnetic_force: [0, 0, 0],
			acceleration: [0, 0, 0],
			rotation: [0, 0],

			// micro:bit v2	
			play_sound: 0,
            microphone: 0,
		};

		/**
		* The most recently received value for each gesture.
		* @type {Object.<string, Object>}
		* @private
		*/
		this._gestures = {
			moving: false,
			move: {
				active: false,
				timeout: false
			},
			shake: {
				active: false,
				timeout: false
			},
			jump: {
				active: false,
				timeout: false
			}
		};

		this.onMessage = this.onMessage.bind(this);
	}

	send (cmd, data) {
		if( this._runtime._mbitlink.instance != null) {
			this._runtime._mbitlink.instance.send(cmd + data + "\n");
 		}
	}

	onMessage (data) {
		if(data[0] == 'B') {
			if(data[1] == 'A')
				this._sensors.buttonA = parseInt(data[2]);
			else if(data[1] == 'B')
				this._sensors.buttonB = parseInt(data[2]);
			else if(data[1] == 'L')
				this._sensors.touchLogo = parseInt(data[2]);
			else if(data[1] == '0')
				this._sensors.touch_pins[0] = parseInt(data[2]);
			else if(data[1] == '1')
				this._sensors.touch_pins[1] = parseInt(data[2]);
			else if(data[1] == '2')
				this._sensors.touch_pins[2] = parseInt(data[2]);
			return true;
		}
		if(data[0] == 'G') {
			this._sensors.gestureState = data.substr(2);
			return true;
		}
		if(data[0] == 'V') {
			this._sensors.light_level = parseInt(data.substr(2));
			return true;
		}
		if(data[0] == 'T') {
			this._sensors.temperature = parseInt(data.substr(2));
			return true;
		}
		if(data[0] == 'F') {
			this._sensors.magnetic_force = this.hex_array(data.substr(2));
			return true;
		}
		if(data[0] == 'A') {
			this._sensors.acceleration = this.hex_array(data.substr(2));
			return true;
		}
		if(data[0] == 'R') {
			this._sensors.rotation = this.hex_array(data.substr(2));
			return true;
		}
		if(data[0] == 'P') {
			this._sensors.microphone = parseInt(data.substr(2));
			return true;
		}
		if(data[0] == 'D') {
			if(data[1] == 'T') {
				if(data[2] == 'S') {
					this._sensors.play_sound = 1;
				} else {
					this._sensors.play_sound = 0;
				}
				return true;
			}
		}
		return false;
	}
	
	/**
	* @return {boolean} - the latest value received for the A button.
	*/
	get buttonA () {
		return this._sensors.buttonA;
	}

	/**
	* @return {boolean} - the latest value received for the B button.
	*/
	get buttonB () {
		return this._sensors.buttonB;
	}

	/**
	* @return {boolean} - the latest value received for the B button.
	*/
	get touchLogo () {
		return this._sensors.touchLogo;
	}

	/**
	* @return {number} - the latest value received for the motion gesture states.
	*/
	get gestureState () {
		return this._sensors.gestureState;
	}

	/**
	* @return {Uint8Array} - the current state of the 5x5 LED matrix.
	*/
	get ledMatrixState () {
		return this._sensors.ledMatrixState;
	}

	get light_level () {
		return this._sensors.light_level;
	}
	get temperature () {
		return this._sensors.temperature;
	}
	get magnetic_force () {
		return this._sensors.magnetic_force;
	}
	get acceleration () {
		return this._sensors.acceleration;
	}
	get rotation () {
		return this._sensors.rotation;
	}

	get touch_pins () {
		return this._sensors.touch_pins;
	}

	get play_sound () {
		return this._sensors.play_sound;
	}
	get microphone () {
		return this._sensors.microphone;
	}

	hex2dec (val) {
		let d = parseInt(val, 16);
		if (d & 0x00008000) {
			d |= 0xffff0000;
		}
		return d;
	}
	hex_array (val) {
		let v = [];
		if (val.length >= 4)
			v[0] = this.hex2dec(val.substring(0, 4));
		if (val.length >= 8)
			v[1] = this.hex2dec(val.substring(4, 8));
		if (val.length >= 12)
			v[2] = this.hex2dec(val.substring(8, 12));
		return v;
	}
}

/**
 * Enum for tilt sensor direction.
 * @readonly
 * @enum {string}
 */
const MBitUART_TiltDirection = {
	FRONT: 'front',
	BACK: 'back',
	LEFT: 'left',
	RIGHT: 'right',
	ANY: 'any'
};

/**
 * Enum for micro:bit gestures.
 * @readonly
 * @enum {string}
 */
const MBitUART_Gestures = {
	SHAKE: 'Shake',
	FREEFALL: 'FreeFall',
	FRONTSIDEUP: 'ScreenUp',
	BACKSIDEUP: 'ScreenDown',
	IMPACT3G: '3G',
	IMPACT6G: '6G',
	IMPACT8G: '8G',
	TILTLEFT: 'TiltLeft',
	TILTRIGHT: 'TiltRight',
	TILTBACKWORDS: 'LogoDown',
	TILTFORWORD: 'LogoUp'
};

/**
 * Enum for micro:bit buttons.
 * @readonly
 * @enum {string}
 */
const MBitUART_Buttons = {
	A: 'A',
	B: 'B',
	ANY: 'any'
};

///**
// * Enum for micro:bit pin states.
// * @readonly
// * @enum {string}
// */
//const MBitUART_PinState = {
//	ON: 'on',
//	OFF: 'off'
//};

const MBitUART_Axis = {
	X: 0,
	Y: 1,
	Z: 2
};

const MBitUART_Rotation = {
	ROLL: 0,
	PITCH: 1
};

const MBitUART_Enable = {
	ENABLE: 1,
	DISABLE: 0
};

const MBitUART_PINMODE = {
	NONE: 0,
	ONOFF: 1,
	VALUE: 2
};

const MBitUART_SoundLevel = {
	LOW: 0,
	MID: 1,
	HIGH: 2
};
const MBitUART_SoundLength = {
	LEN1: 1,
	LEN2: 2,
	LEN4: 4,
	LEN8: 8,
	LEN16: 16
};
const MBitUART_Sound = {
	DO: 0,
	DOS: 1,
	RE: 2,
	RES: 3,
	MI: 4,
	FA: 5,
	FAS: 6,
	SO: 7,
	SOS: 8,
	RA: 9,
	RAS: 10,
	SHI: 11
};
const MBitUART_Express = {
	giggle: "giggle",
	happy: "happy",
	hello: "hello",
	mysterious: "mysterious",
	sad: "sad",
	slide: "slide",
	soaring: "soaring",
	spring: "spring",
	twinkle: "twinkle",
	yawn: "yawn"
};

/**
 * Scratch 3.0 blocks to interact with a MBitUART peripheral.
 */
class Scratch3_MBitUART_Blocks {

	/**
	* @return {string} - the name of this extension.
	*/
	static get EXTENSION_NAME () {
		return 'micro:bit';
	}

	/**
	* @return {string} - the ID of this extension.
	*/
	static get EXTENSION_ID () {
		return 'mbituart';
	}

	/**
	* @return {number} - the tilt sensor counts as "tilted" if its tilt angle meets or exceeds this threshold.
	*/
	static get TILT_THRESHOLD () {
		return 15;
	}

	/**
	* @return {array} - text and values for each buttons menu element
	*/
	get BUTTONS_MENU () {
		return [
			{
				text: 'A',
				value: MBitUART_Buttons.A
			},
			{
				text: 'B',
				value: MBitUART_Buttons.B
			},
			{
				text: formatMessage({
					id: 'mbituart.buttonsMenu.any',
					default: 'Any',
					description: 'label for "any" element in button picker'
				}),
				value: MBitUART_Buttons.ANY
			}
		];
	}
	get TOUCH_PINS_MENU () {
		return [
			{
				text: '0',
				value: 0
			},
			{
				text: '1',
				value: 1
			},
			{
				text: '2',
				value: 2
			},
		];
	}
	get TOUCH_PINMODE_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.pinModeMenu.none',
					default: 'None',
					description: 'label for pin mode picker'
				}),
				value: MBitUART_PINMODE.NONE
			},
			{
				text: formatMessage({
					id: 'mbituart.pinModeMenu.onoff',
					default: 'On/Off',
					description: 'label for pin mode picker'
				}),
				value: MBitUART_PINMODE.ONOFF
			},
			{
				text: formatMessage({
					id: 'mbituart.pinModeMenu.value',
					default: 'Value',
					description: 'label for pin mode picker'
				}),
				value: MBitUART_PINMODE.VALUE
			},
		];
	}

	/**
	* @return {array} - text and values for each gestures menu element
	*/
	get GESTURES_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.shake',
					default: 'Shake',
					description: 'label for shake gesture in gesture picker'
				}),
				value: MBitUART_Gestures.SHAKE
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.tiltforward',
					default: 'LogoUp',
					description: 'label for tiltforward gesture in gesture picker'
				}),
				value: MBitUART_Gestures.TILTFORWORD
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.tiltbackwards',
					default: 'Logo Down',
					description: 'label for tiltbackwards gesture in gesture picker'
				}),
				value: MBitUART_Gestures.TILTBACKWORDS
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.frontsideup',
					default: 'Screen Up',
					description: 'label for frontsideup gesture in gesture picker'
				}),
				value: MBitUART_Gestures.FRONTSIDEUP
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.backsideup',
					default: 'Screen Down',
					description: 'label for backsideup gesture in gesture picker'
				}),
				value: MBitUART_Gestures.BACKSIDEUP
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.tiltleft',
					default: 'Tilt Left',
					description: 'label for tiltleft gesture in gesture picker'
				}),
				value: MBitUART_Gestures.TILTLEFT
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.tiltright',
					default: 'Tilt Right',
					description: 'label for tiltright gesture in gesture picker'
				}),
				value: MBitUART_Gestures.TILTRIGHT
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.freefall',
					default: 'FreeFall',
					description: 'label for freefall gesture in gesture picker'
				}),
				value: MBitUART_Gestures.FREEFALL
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.impact3g',
					default: '3G',
					description: 'label for impact3g gesture in gesture picker'
				}),
				value: MBitUART_Gestures.IMPACT3G
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.impact6g',
					default: '6G',
					description: 'label for impact6g gesture in gesture picker'
				}),
				value: MBitUART_Gestures.IMPACT6G
			},
			{
				text: formatMessage({
					id: 'mbituart.gesturesMenu.impact8g',
					default: '8G',
					description: 'label for frontsideup gesture in gesture picker'
				}),
				value: MBitUART_Gestures.IMPACT8G
			}
		];
	}

	get AXIS_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.axisMenu.x',
					default: 'X',
					description: 'label for type picker'
				}),
				value: MBitUART_Axis.X
			},
			{
				text: formatMessage({
					id: 'mbituart.axisMenu.y',
					default: 'Y',
					description: 'label for type picker'
				}),
				value: MBitUART_Axis.Y
			},
			{
				text: formatMessage({
					id: 'mbituart.axisMenu.z',
					default: 'Z',
					description: 'label for type picker'
				}),
				value: MBitUART_Axis.Z
			}
		];
	}

	get ROTATION_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.rotationMenu.roll',
					default: 'Roll',
					description: 'label for rotate picker'
				}),
				value: MBitUART_Rotation.ROLL
			},
			{
				text: formatMessage({
					id: 'mbituart.rotationMenu.pitch',
					default: 'Pitch',
					description: 'label for rotate picker'
				}),
				value: MBitUART_Rotation.PITCH
			}
		];
	}

	get ENABLE_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.enableMenu.enable',
					default: 'Enable',
					description: 'label for enable picker'
				}),
				value: MBitUART_Enable.ENABLE
			},
			{
				text: formatMessage({
					id: 'mbituart.enableManu.disable',
					default: 'Disable',
					description: 'label for enable picker'
				}),
				value: MBitUART_Enable.DISABLE
			}
		];
	}

	get SOUND_LENGTH_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.soundLengthMenu.Len16',
					default: '1/16',
					description: 'label for enable picker'
				}),
				value: MBitUART_SoundLength.LEN16
			},
			{
				text: formatMessage({
					id: 'mbituart.soundLengthMenu.Len8',
					default: '1/8',
					description: 'label for enable picker'
				}),
				value: MBitUART_SoundLength.LEN8
			},
			{
				text: formatMessage({
					id: 'mbituart.soundLengthMenu.Len4',
					default: '1/4',
					description: 'label for enable picker'
				}),
				value: MBitUART_SoundLength.LEN4
			},
			{
				text: formatMessage({
					id: 'mbituart.soundLengthMenu.Len2',
					default: '1/2',
					description: 'label for enable picker'
				}),
				value: MBitUART_SoundLength.LEN2
			},
			{
				text: formatMessage({
					id: 'mbituart.soundLengthMenu.Len1',
					default: '1',
					description: 'label for enable picker'
				}),
				value: MBitUART_SoundLength.LEN1
			}
		];
	}
	get SOUND_LEVEL_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.soundLevelMenu.Low',
					default: 'Low',
					description: 'label for enable picker'
				}),
				value: MBitUART_SoundLevel.LOW
			},
			{
				text: formatMessage({
					id: 'mbituart.soundLevelMenu.Mid',
					default: 'Middle',
					description: 'label for enable picker'
				}),
				value: MBitUART_SoundLevel.MID
			},
			{
				text: formatMessage({
					id: 'mbituart.soundLevelMenu.High',
					default: 'High',
					description: 'label for enable picker'
				}),
				value: MBitUART_SoundLevel.HIGH
			}
		];
	}
	get SOUND_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.Do',
					default: 'Do',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.DO
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.DoS',
					default: 'Do#',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.DOS
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.Re',
					default: 'Re',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.RE
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.ReS',
					default: 'Re#',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.RES
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.Mi',
					default: 'Mi',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.MI
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.Fa',
					default: 'Fa',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.FA
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.FaS',
					default: 'Fa#',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.FAS
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.So',
					default: 'So',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.SO
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.SoS',
					default: 'So#',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.SOS
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.Ra',
					default: 'Ra',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.RA
			},
			{
				text: formatMessage({
					id: 'mbituart.soundMenu.Shi',
					default: 'Shi',
					description: 'label for enable picker'
				}),
				value: MBitUART_Sound.SHI
			}
		];
	}
	get EXPRESS_MENU () {
		return [
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.giggle',
					default: 'Giggle',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.giggle
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.happy',
					default: 'Happy',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.happy
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.hello',
					default: 'Hello',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.hello
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.mysterious',
					default: 'Mysterious',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.mysterious
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.sad',
					default: 'Sad',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.sad
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.slide',
					default: 'Slide',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.slide
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.soaring',
					default: 'Soaring',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.soaring
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.spring',
					default: 'Spring',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.spring
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.twinkle',
					default: 'Twinkle',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.twinkle
			},
			{
				text: formatMessage({
					id: 'mbituart.expressMenu.yawn',
					default: 'Yawn',
					description: 'label for enable picker'
				}),
				value: MBitUART_Express.yawn
			}
		];
	}

    /**
     * @return {array} - text and values for each tilt direction menu element
     */
    get TILT_DIRECTION_MENU () {
        return [
            {
                text: formatMessage({
                    id: 'mbituart.tiltDirectionMenu.front',
                    default: 'Front',
                    description: 'label for front element in tilt direction picker for micro:bit extension'
                }),
                value: MBitUART_TiltDirection.FRONT
            },
            {
                text: formatMessage({
                    id: 'mbituart.tiltDirectionMenu.back',
                    default: 'Back',
                    description: 'label for back element in tilt direction picker for micro:bit extension'
                }),
                value: MBitUART_TiltDirection.BACK
            },
            {
                text: formatMessage({
                    id: 'mbituart.tiltDirectionMenu.left',
                    default: 'Left',
                    description: 'label for left element in tilt direction picker for micro:bit extension'
                }),
                value: MBitUART_TiltDirection.LEFT
            },
            {
                text: formatMessage({
                    id: 'mbituart.tiltDirectionMenu.right',
                    default: 'Right',
                    description: 'label for right element in tilt direction picker for micro:bit extension'
                }),
                value: MBitUART_TiltDirection.RIGHT
            }
        ];
    }

	/**
	* @return {array} - text and values for each tilt direction (plus "any") menu element
	*/
	get TILT_DIRECTION_ANY_MENU () {
		return [
			...this.TILT_DIRECTION_MENU,
			{
				text: formatMessage({
					id: 'mbituart.tiltDirectionMenu.any',
					default: 'Any',
					description: 'label for any direction element in tilt direction picker'
				}),
				value: MBitUART_TiltDirection.ANY
			}
		];
	}

	/**
	* Construct a set of MBitUART blocks.
	* @param {Runtime} runtime - the Scratch 3.0 runtime.
	*/
	constructor (runtime) {
		/**
		* The Scratch 3.0 runtime.
		* @type {Runtime}
		*/
		this.runtime = runtime;

		// Create a new MBitUART peripheral instance
		this.instance = new MBitUART(this.runtime, Scratch3_MBitUART_Blocks.EXTENSION_ID);
	}

	/**
	* @returns {object} metadata for this extension and its blocks.
	*/
	getInfo () {
		this.setupTranslations();
		return {
			id: Scratch3_MBitUART_Blocks.EXTENSION_ID,
			name: Scratch3_MBitUART_Blocks.EXTENSION_NAME,
			color1:   '#0FBDAC',
			color2:   '#0DA59A',
			color3:   '#0B8E89',
			blockIconURI: blockIconURI,
			//showStatusButton: true,
			blocks: [
				{
					opcode: 'whenLogoTouched',
					text: formatMessage({
						id: 'mbituart.whenLogoTouched',
						default: 'When logo touched',
						description: 'when the logo on the micro:bit is touched'
					}),
					blockType: BlockType.HAT
				},
				{
					opcode: 'isLogoTouched',
					text: formatMessage({
						id: 'mbituart.isLogoTouched',
						default: 'Logo touched?',
						description: 'is the logo on the micro:bit touched?'
					}),
					blockType: BlockType.BOOLEAN
				},
				{
					opcode: 'whenButtonPressed',
					text: formatMessage({
						id: 'mbituart.whenButtonPressed',
						default: 'When [BTN] button pressed',
						description: 'when the selected button on the micro:bit is pressed'
					}),
					blockType: BlockType.HAT,
					arguments: {
						BTN: {
							type: ArgumentType.STRING,
							menu: 'buttons',
							defaultValue: MBitUART_Buttons.A
						}
					}
				},
				{
					opcode: 'isButtonPressed',
					text: formatMessage({
						id: 'mbituart.isButtonPressed',
						default: '[BTN] button pressed?',
						description: 'is the selected button on the micro:bit pressed?'
					}),
					blockType: BlockType.BOOLEAN,
					arguments: {
						BTN: {
							type: ArgumentType.STRING,
							menu: 'buttons',
							defaultValue: MBitUART_Buttons.A
						}
					}
				},
				{
					opcode: 'getLightLevel',
					text: formatMessage({
						id: 'mbituart.getLightLevel',
						default: 'Light level',
						description: 'light level'
					}),
					blockType: BlockType.REPORTER
				},
				{
					opcode: 'getTemperature',
					text: formatMessage({
						id: 'mbituart.getTemperature',
						default: 'Temperature',
						description: 'temperature'
					}),
					blockType: BlockType.REPORTER
				},
				{
					opcode: 'whenPinConnected',
					text: formatMessage({
						id: 'mbituart.whenPinConnected',
						default: 'When pin [PIN] connected',
						description: 'when the pin detects a connection to Earth/Ground'

					}),
					blockType: BlockType.HAT,
					arguments: {
						PIN: {
							type: ArgumentType.NUMBER,
							menu: 'touchPins',
							defaultValue: 0
						}
					}
				},
				{
					opcode: 'getPinConnected',
					text: formatMessage({
						id: 'mbituart.getPinConnected',
						default: 'When pin [PIN] connected',
						description: 'when the pin detects a connection to Earth/Ground'

					}),
					blockType: BlockType.REPORTER,
					arguments: {
						PIN: {
							type: ArgumentType.NUMBER,
							menu: 'touchPins',
							defaultValue: 0
						}
					}
				},
				{
					opcode: 'outPinValue',
					text: formatMessage({
						id: 'mbituart.outPinValue',
						default: 'Output [VALUE] to pin [PIN] ',
						description: 'output value to the pin'

					}),
					blockType: BlockType.COMMAND,
					arguments: {
						PIN: {
							type: ArgumentType.NUMBER,
							menu: 'touchPins',
							defaultValue: 0
						},
						VALUE: {
							type: ArgumentType.NUMBER,
							defaultValue: 0
						}
					}
				},
				{
					opcode: 'setPinConfig',
					text: formatMessage({
						id: 'mbituart.setPinConfig',
						default: 'Pin [PIN] with [MODE]',
						description: 'set the pin mode'

					}),
					blockType: BlockType.COMMAND,
					arguments: {
						PIN: {
							type: ArgumentType.NUMBER,
							menu: 'touchPins',
							defaultValue: 0
						},
						MODE: {
							type: ArgumentType.STRING,
							menu: 'pinMode',
							defaultValue: MBitUART_PINMODE.NONE
						}
					}
				},
				{
					opcode: 'whenGesture',
					text: formatMessage({
						id: 'mbituart.whenGesture',
						default: 'When [GESTURE]',
						description: 'when the selected gesture is detected by the micro:bit'
					}),
					blockType: BlockType.HAT,
					arguments: {
						GESTURE: {
							type: ArgumentType.STRING,
							menu: 'gestures',
							defaultValue: MBitUART_Gestures.MOVED
						}
					}
				},
				{
					opcode: 'getGesture',
					text: formatMessage({
						id: 'mbituart.getGesture',
						default: 'Get gesture',
						description: 'get gesture'
					}),
					blockType: BlockType.REPORTER
				},
				{
					opcode: 'setSensor',
					text: formatMessage({
						id: 'mbituart.setSensor',
						default: '[ENABLE] basic sensor(Logo, Buttons, Light level, Temperature)',
						description: 'enable/disable basic sensor(logo, buttons, light level, temperature, etc)'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						ENABLE: {
							type: ArgumentType.NUMBER,
							menu: 'enable',
							defaultValue: 1
						}
					}
				},
				'---',
				{
					opcode: 'displaySymbol',
					text: formatMessage({
						id: 'mbituart.displaySymbol',
						default: 'Display [MATRIX]',
						description: 'display a pattern on the micro:bit display'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						MATRIX: {
							type: ArgumentType.MATRIX,
							defaultValue: '0101010101100010101000100'
						}
					}
				},
				{
					opcode: 'displayText',
					text: formatMessage({
						id: 'mbituart.displayText',
						default: 'Display text [TEXT]',
						description: 'display text on the micro:bit display'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						TEXT: {
							type: ArgumentType.STRING,
							defaultValue: formatMessage({
								id: 'mbituart.defaultTextToDisplay',
								default: 'Hello!',
								description: `default text to display.
								IMPORTANT - the micro:bit only supports letters a-z, A-Z.
								Please substitute a default word in your language
								that can be written with those characters,
								substitute non-accented characters or leave it as "Hello!".
								Check the micro:bit site documentation for details`
							})
						}
					}
				},
				{
					opcode: 'displayClear',
					text: formatMessage({
						id: 'mbituart.clearDisplay',
						default: 'Clear display',
						description: 'display nothing on the micro:bit display'
					}),
					blockType: BlockType.COMMAND
				},
				'---',
				{
					opcode: 'playExpress',
					text: formatMessage({
						id: 'mbituart.playExpress',
						default: 'Play [EXPRESS]',
						description: 'play express'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						EXPRESS: {
							type: ArgumentType.STRING,
							menu: 'express',
							defaultValue: MBitUART_Express.giggle
						}
					}
				},
				{
					opcode: 'playTone',
					text: formatMessage({
						id: 'mbituart.playTone',
						default: 'Play tone [LEVEL] [KIND], Length [LEN]',
						description: 'play tone'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						LEVEL: {
							type: ArgumentType.NUMBER,
							menu: 'soundlevel',
							defaultValue: MBitUART_SoundLevel.MID
						},
						KIND: {
							type: ArgumentType.NUMBER,
							menu: 'sound',
							defaultValue: MBitUART_Sound.DO
						},
						LEN: {
							type: ArgumentType.NUMBER,
							menu: 'soundlength',
							defaultValue: MBitUART_SoundLength.LEN16
						}
					}
				},
				{
					opcode: 'getPlaySound',
					text: formatMessage({
						id: 'mbituart.getPlaySound',
						default: 'Is play sound?',
						description: 'is play sound?'
					}),
					blockType: BlockType.REPORTER,
				},
				'---',
				{
					opcode: 'getAcceleration',
					text: formatMessage({
						id: 'mbituart.getAcceleration',
						default: 'Acceleration [AXIS]',
						description: 'acceleration'
					}),
					blockType: BlockType.REPORTER,
					arguments: {
						AXIS: {
							type: ArgumentType.NUMBER,
							menu: 'axis',
							defaultValue: 0
						}
					}
				},
				{
					opcode: 'setAcceleration',
					text: formatMessage({
						id: 'mbituart.setAcceleration',
						default: 'Round acceleration with [ROUND]',
						description: 'round value of acceleration'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						ROUND: {
							type: ArgumentType.NUMBER,
							defaultValue: 10
						}
					}
				},
				'---',
				{
					opcode: 'getMagneticForce',
					text: formatMessage({
						id: 'mbituart.getMagneticForce',
						default: 'Magnetic force [AXIS]',
						description: 'magnetic force'
					}),
					blockType: BlockType.REPORTER,
					arguments: {
						AXIS: {
							type: ArgumentType.NUMBER,
							menu: 'axis',
							defaultValue: 0
						}
					}
				},
				{
					opcode: 'setMagneticForce',
					text: formatMessage({
						id: 'mbituart.setMagneticForce',
						default: 'Round magnetic force with [ROUND]',
						description: 'round value of magnetic force'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						ROUND: {
							type: ArgumentType.NUMBER,
							defaultValue: 10
						}
					}
				},
				'---',
				{
					opcode: 'whenTilted',
					text: formatMessage({
						id: 'mbituart.whenTilted',
						default: 'When tilted [DIRECTION]',
						description: 'when the micro:bit is tilted in a direction'
					}),
					blockType: BlockType.HAT,
					arguments: {
						DIRECTION: {
							type: ArgumentType.STRING,
							menu: 'tiltDirectionAny',
							defaultValue: MBitUART_TiltDirection.ANY
						}
					}
				},
				{
					opcode: 'isTilted',
					text: formatMessage({
						id: 'mbituart.isTilted',
						default: 'Tilted [DIRECTION]?',
						description: 'is the micro:bit is tilted in a direction?'
					}),
					blockType: BlockType.BOOLEAN,
					arguments: {
						DIRECTION: {
							type: ArgumentType.STRING,
							menu: 'tiltDirectionAny',
							defaultValue: MBitUART_TiltDirection.ANY
						}
					}
				},
				{
					opcode: 'getTiltAngle',
					text: formatMessage({
						id: 'mbituart.tiltAngle',
						default: 'tilt angle [DIRECTION]',
						description: 'how much the micro:bit is tilted in a direction'
					}),
					blockType: BlockType.REPORTER,
					arguments: {
						DIRECTION: {
							type: ArgumentType.STRING,
							menu: 'tiltDirection',
							defaultValue: MBitUART_TiltDirection.FRONT
						}
					}
				},
				{
					opcode: 'getRotation',
					text: formatMessage({
						id: 'mbituart.getRotation',
						default: 'Rotation [ROTATION]',
						description: 'rotation'
					}),
					blockType: BlockType.REPORTER,
					arguments: {
						ROTATION: {
							type: ArgumentType.NUMBER,
							menu: 'rotation',
							defaultValue: 0
						}
					}
				},
				{
					opcode: 'setRotation',
					text: formatMessage({
						id: 'mbituart.setRotation',
						default: 'Round rotation with [ROUND]',
						description: 'round value of rotation'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						ROUND: {
							type: ArgumentType.NUMBER,
							defaultValue: 10
						}
					}
				},
				'---',
				{
					opcode: 'getMicrophone',
					text: formatMessage({
						id: 'mbituart.getMicrophone',
						default: 'Microphone level',
						description: 'microphone level'
					}),
					blockType: BlockType.REPORTER
				},
				{
					opcode: 'setMicrophone',
					text: formatMessage({
						id: 'mbituart.setMicrophone',
						default: 'Round microphone with [ROUND]',
						description: 'round value of microphone'
					}),
					blockType: BlockType.COMMAND,
					arguments: {
						ROUND: {
							type: ArgumentType.NUMBER,
							defaultValue: 5
						}
					}
				},
			],
			menus: {
				buttons: {
					acceptReporters: true,
					items: this.BUTTONS_MENU
				},
				gestures: {
					acceptReporters: true,
					items: this.GESTURES_MENU
				},
				//pinState: {
				//	acceptReporters: true,
				//	items: this.PIN_STATE_MENU
				//},
				tiltDirection: {
					acceptReporters: true,
					items: this.TILT_DIRECTION_MENU
				},
				tiltDirectionAny: {
					acceptReporters: true,
					items: this.TILT_DIRECTION_ANY_MENU
				},
				touchPins: {
					acceptReporters: true,
					items: this.TOUCH_PINS_MENU
				},
				pinMode: {
					acceptReporters: true,
					items: this.TOUCH_PINMODE_MENU
				},
				rotation: {
					acceptReporters: true,
					items: this.ROTATION_MENU
				},
				axis: {
					acceptReporters: true,
					items: this.AXIS_MENU
				},
				enable: {
					acceptReporters: true,
					items: this.ENABLE_MENU
				},
				soundlength: {
					acceptReporters: true,
					items: this.SOUND_LENGTH_MENU
				},
				soundlevel: {
					acceptReporters: true,
					items: this.SOUND_LEVEL_MENU
				},
				sound: {
					acceptReporters: true,
					items: this.SOUND_MENU
				},
				express: {
					acceptReporters: true,
					items: this.EXPRESS_MENU
				}
			}
		};
	}

	/**
	* Test whether the A or B button is pressed
	* @param {object} args - the block's arguments.
	* @return {boolean} - true if the button is pressed.
	*/
	whenButtonPressed (args) {
		if (args.BTN === 'any') {
			return this.instance.buttonA
				| this.instance.buttonB;
		} else if (args.BTN === 'A') {
			return this.instance.buttonA;
		} else if (args.BTN === 'B') {
			return this.instance.buttonB;
		}
		return false;
	}

	/**
	* Test whether the A or B button is pressed
	* @param {object} args - the block's arguments.
	* @return {boolean} - true if the button is pressed.
	*/
	isButtonPressed (args) {
		if (args.BTN === 'any') {
			return (this.instance.buttonA
					| this.instance.buttonB) !== 0;
		} else if (args.BTN === 'A') {
			return this.instance.buttonA !== 0;
		} else if (args.BTN === 'B') {
			return this.instance.buttonB !== 0;
		}
		return false;
	}

	whenLogoTouched () {
		return this.instance.touchLogo;
	}
	isLogoTouched (args) {
		return this.instance.touchLogo !== 0;
	}
	
	/**
	* Test whether the micro:bit is moving
	* @param {object} args - the block's arguments.
	* @return {boolean} - true if the micro:bit is moving.
	*/
	whenGesture (args) {
		if (args.GESTURE === this.instance.gestureState)
			return true;
		return false;
	}
	getGesture () {
		return this.instance.gestureState;
	}

	/**
	* Display a predefined symbol on the 5x5 LED matrix.
	* @param {object} args - the block's arguments.
	* @return {Promise} - a Promise that resolves after a tick.
	*/
	displaySymbol (args) {
		const symbol = cast.toString(args.MATRIX).replace(/\s/g, '');
		const reducer = (accumulator, c, index) => {
			const value = (c === '0') ? accumulator : accumulator + Math.pow(2, index);
			return value;
		};
		const hex = symbol.split('').reduce(reducer, 0);
		if (hex !== null) {
			this.instance.ledMatrixState[0] = hex & 0x1F;
			this.instance.ledMatrixState[1] = (hex >> 5) & 0x1F;
			this.instance.ledMatrixState[2] = (hex >> 10) & 0x1F;
			this.instance.ledMatrixState[3] = (hex >> 15) & 0x1F;
			this.instance.ledMatrixState[4] = (hex >> 20) & 0x1F;

			const c = "0123456789ABCDEFGHIJKLMNOPQRSTUV"
			let s = c.charAt(this.instance.ledMatrixState[0]);
			s += c.charAt(this.instance.ledMatrixState[1]);
			s += c.charAt(this.instance.ledMatrixState[2]);
			s += c.charAt(this.instance.ledMatrixState[3]);
			s += c.charAt(this.instance.ledMatrixState[4]);
			this.instance.send(CMD.DISPLAY_LED, s);
		}

		return new Promise(resolve => {
			setTimeout(() => {
				resolve();
			}, BLESendInterval);
		});
	}

	/**
	* Display text on the 5x5 LED matrix.
	* @param {object} args - the block's arguments.
	* @return {Promise} - a Promise that resolves after the text is done printing.
	* Note the limit is 18 characters
	* The print time is calculated by multiplying the number of horizontal pixels
	* by the default scroll delay of 120ms.
	* The number of horizontal pixels = 6px for each character in the string,
	* 1px before the string, and 5px after the string.
	*/
	displayText (args) {
		const text = String(args.TEXT).substring(0, 18);
		//if (text.length > 0)
		this.instance.send(CMD.DISPLAY_TEXT, text);
		const yieldDelay = 120 * ((6 * text.length) + 6);

		return new Promise(resolve => {
			setTimeout(() => {
				resolve();
			}, yieldDelay);
		});
	}

	/**
	* Turn all 5x5 matrix LEDs off.
	* @return {Promise} - a Promise that resolves after a tick.
	*/
	displayClear () {
		this.displayText({TEXT:""});
	}

	/**
	* Test whether the tilt sensor is currently tilted.
	* @param {object} args - the block's arguments.
	* @property {TiltDirection} DIRECTION - the tilt direction to test (front, back, left, right, or any).
	* @return {boolean} - true if the tilt sensor is tilted past a threshold in the specified direction.
	*/
	whenTilted (args) {
		return this._isTilted(args.DIRECTION);
	}

	/**
	* Test whether the tilt sensor is currently tilted.
	* @param {object} args - the block's arguments.
	* @property {TiltDirection} DIRECTION - the tilt direction to test (front, back, left, right, or any).
	* @return {boolean} - true if the tilt sensor is tilted past a threshold in the specified direction.
	*/
	isTilted (args) {
		return this._isTilted(args.DIRECTION);
	}

	/**
	* @param {object} args - the block's arguments.
	* @property {TiltDirection} DIRECTION - the direction (front, back, left, right) to check.
	* @return {number} - the tilt sensor's angle in the specified direction.
	* Note that getTiltAngle(front) = -getTiltAngle(back) and getTiltAngle(left) = -getTiltAngle(right).
	*/
	getTiltAngle (args) {
		return this._getTiltAngle(args.DIRECTION);
	}

	/**
	* Test whether the tilt sensor is currently tilted.
	* @param {TiltDirection} direction - the tilt direction to test (front, back, left, right, or any).
	* @return {boolean} - true if the tilt sensor is tilted past a threshold in the specified direction.
	* @private
	*/
	_isTilted (direction) {
		switch (direction) {
		case MBitUART_TiltDirection.ANY:
			return (Math.abs(this.instance.rotation[0] / 10) >= Scratch3_MBitUART_Blocks.TILT_THRESHOLD) ||
				(Math.abs(this.instance.rotation[1] / 10) >= Scratch3_MBitUART_Blocks.TILT_THRESHOLD);
		default:
			return this._getTiltAngle(direction) >= Scratch3_MBitUART_Blocks.TILT_THRESHOLD;
		}
	}

	/**
	* @param {TiltDirection} direction - the direction (front, back, left, right) to check.
	* @return {number} - the tilt sensor's angle in the specified direction.
	* Note that getTiltAngle(front) = -getTiltAngle(back) and getTiltAngle(left) = -getTiltAngle(right).
	* @private
	*/
	_getTiltAngle (direction) {
		switch (direction) {
		case MBitUART_TiltDirection.FRONT:
			return Math.round(this.instance.rotation[1] / -10);
		case MBitUART_TiltDirection.BACK:
			return Math.round(this.instance.rotation[1] / 10);
		case MBitUART_TiltDirection.LEFT:
			return Math.round(this.instance.rotation[0] / -10);
		case MBitUART_TiltDirection.RIGHT:
			return Math.round(this.instance.rotation[0] / 10);
		default:
			log.warn(`Unknown tilt direction in _getTiltAngle: ${direction}`);
		}
	}

	/**
	* @param {object} args - the block's arguments.
	* @return {boolean} - the touch pin state.
	* @private
	*/
	whenPinConnected (args) {
		return this.instance.touch_pins[args.PIN];
	}
	getPinConnected (args) {
		return this.instance.touch_pins[args.PIN];
	}
	outPinValue (args) {
		if(argsPIN == "0") {
			this.command(CMD.WRITE_PIN_0, args.VALUE);
			return;
		}
		if(argsPIN == "1") {
			this.command(CMD.WRITE_PIN_1, args.VALUE);
			return;
		}
		if(argsPIN == "2") {
			this.command(CMD.WRITE_PIN_2, args.VALUE);
			return;
		}
	}
	setPinConfig (args) {
		let flag = (args.MODE == "onoff")? "1" :
			(args.MODE == "value")? "2" : "0";
		if(argsPIN == "0") {
			this.command(CMD.MODE_PIN_0, flag);
			return;
		}
		if(argsPIN == "1") {
			this.command(CMD.MODE_PIN_1, flag);
			return;
		}
		if(argsPIN == "2") {
			this.command(CMD.MODE_PIN_2, flag);
			return;
		}
	}

	getLightLevel () {
		return this.instance.light_level;
	}
	getTemperature () {
		return this.instance.temperature;
	}
	getMagneticForce (args) {
		return this.instance.magnetic_force[args.AXIS];
	}
	getAcceleration (args) {
		return this.instance.acceleration[args.AXIS];
	}
	getRotation (args) {
		return this.instance.rotation[args.ROTATION];
	}
	getMicrophone (args) {
		return this.instance.microphone;
	}

	setSensor (args) {
		this.command(CMD.SENSOR, (args.ENABLE == 0)? "0" : ("" + (1 + 2 + 4 + 16)));
	}
	setMagneticForce (args) {
		this.command(CMD.MAGNETIC_FORCE, args.ROUND);
	}
	setAcceleration (args) {
		this.command(CMD.ACCELERATION, args.ROUND);
	}
	setRotation (args) {
		this.command(CMD.ROTATION, args.ROUND);
	}
	setMicrophone (args) {
		this.command(CMD.MICROPHONE, args.ROUND);
	}
	playTone(args) {
		const tone = [
		[131, 139, 147, 156, 165, 175, 185, 196, 208, 220, 233, 247],
		[262, 277, 294, 311, 330, 349, 370, 392, 415, 440, 466, 498],
		[523, 554, 587, 622, 659, 698, 740, 784, 831, 880, 932, 988] ];
		if(args.LEN == "1") {
			this.command(CMD.PLAY_TONE_1, tone[args.LEVEL][args.KIND]);
		} else if(args.LEN == "2") {
			this.command(CMD.PLAY_TONE_2, tone[args.LEVEL][args.KIND]);
		} else if(args.LEN == "4") {
			this.command(CMD.PLAY_TONE_4, tone[args.LEVEL][args.KIND]);
		} else if(args.LEN == "8") {
			this.command(CMD.PLAY_TONE_8, tone[args.LEVEL][args.KIND]);
		} else {
			this.command(CMD.PLAY_TONE_16, tone[args.LEVEL][args.KIND]);
		}
	}
	playExpress(args) {
		this.command(CMD.PLAY_EXPRESS, args.EXPRESS);
	}
	getPlaySound() {
		return this.instance.play_sound;
	}
	command(cmd, arg) {
		this.instance.send(cmd, arg);
		return new Promise(resolve => {
			setTimeout(() => {
				resolve();
			}, BLESendInterval);
		});
	}

	setupTranslations () {
		const localeSetup = formatMessage.setup();
		const extTranslations = {
			'ja': {
			    "mbituart.buttonsMenu.any": "どれかの",
			    "mbituart.clearDisplay": "画面を消す",
			    "mbituart.defaultTextToDisplay": "Hello!",
			    "mbituart.displaySymbol": "[MATRIX]を表示する",
			    "mbituart.displayText": "[TEXT]を表示する",
			    //"mbituart.gesturesMenu.jumped": "ジャンプした",
			    //"mbituart.gesturesMenu.moved": "動いた",
			    //"mbituart.gesturesMenu.shaken": "振られた",
			    "mbituart.isButtonPressed": "ボタン[BTN]が押された",
			    "mbituart.isTilted": "[DIRECTION]に傾いた",
			    //"mbituart.pinStateMenu.off": "切",
			    //"mbituart.pinStateMenu.on": "入",
			    "mbituart.tiltAngle": "[DIRECTION]方向の傾き",
			    "mbituart.tiltDirectionMenu.any": "どれかの向き",
			    "mbituart.tiltDirectionMenu.back": "後ろ",
			    "mbituart.tiltDirectionMenu.front": "前",
			    "mbituart.tiltDirectionMenu.left": "左",
			    "mbituart.tiltDirectionMenu.right": "右",
			    "mbituart.whenButtonPressed": "ボタン[BTN]が押されたとき",
			    "mbituart.whenGesture": "[GESTURE]とき",
			    "mbituart.getGesture": "ジェスチャー",
			    "mbituart.whenPinConnected": "ピン[PIN]がつながったとき",
			    "mbituart.getPinConnected": "ピン[PIN]",
			    "mbituart.outPinValue": "ピン[PIN]を[VALUE]にする",
			    "mbituart.setPinConfig": "ピン[PIN]を[MODE]",
			    "mbituart.whenTilted": "[DIRECTION]に傾いたとき",
				'mbituart.whenLogoTouched': 'ロゴがタッチされたとき',
				'mbituart.isLogoTouched':"ロゴがタッチされた",
				'mbituart.getLightLevel': '明るさセンサー',
				'mbituart.getTemperature': '温度センサー',
				'mbituart.getAcceleration': '加速度センサー[AXIS]',
				'mbituart.getMagneticForce': '磁力センサー[AXIS]',
				'mbituart.getRotation': '回転センサー[ROTATION]',
				'mbituart.getMicrophone': 'マイク音量',
				'mbituart.setSensor': '基本センサー(ロゴ,ボタン,明るさ,温度など)を[ENABLE]',
				'mbituart.setMagneticForce': '磁力センサーを[ROUND]でまるめる',
				'mbituart.setAcceleration': '加速度センサーを[ROUND]でまるめる',
				'mbituart.setRotation': '回転センサーを[ROUND]でまるめる',
				'mbituart.setMicrophone': 'マイク音量を[ROUND]でまるめる',
				'mbituart.axisMenu.x': 'X軸',
				'mbituart.axisMenu.y': 'Y軸',
				'mbituart.axisMenu.z': 'Z軸',
				'mbituart.rotationMenu.roll': 'ロール',
				'mbituart.rotationMenu.pitch': 'ピッチ',
				'mbituart.enableMenu.enable': '使う',
				'mbituart.enableManu.disable': '使わない',
				'mbituart.gesturesMenu.shake': 'ゆさぶられた',
				'mbituart.gesturesMenu.freefall': '落とした',
				'mbituart.gesturesMenu.frontsideup': '画面が上になった',
				'mbituart.gesturesMenu.backsideup': '画面が下になった',
				'mbituart.gesturesMenu.impact3g': '3G',
				'mbituart.gesturesMenu.impact6g': '6G',
				'mbituart.gesturesMenu.impact8g': '8G',
				'mbituart.gesturesMenu.tiltleft': '左に傾けた',
				'mbituart.gesturesMenu.tiltright': '右に傾けた',
				'mbituart.gesturesMenu.tiltbackwards': 'ロゴが下になった',
				'mbituart.gesturesMenu.tiltforward': 'ロゴが上になった',
				'mbituart.enableManu.disable': '使わない',
				'mbituart.playTone': '[LEVEL][KIND]を[LEN]で鳴らす',
				'mbituart.soundMenu.Do': 'ド',
				'mbituart.soundMenu.DoS': 'ド#',
				'mbituart.soundMenu.Re': 'レ',
				'mbituart.soundMenu.ReS': 'レ#',
				'mbituart.soundMenu.Mi': 'ミ',
				'mbituart.soundMenu.Fa': 'ファ',
				'mbituart.soundMenu.FaS': 'ファ#',
				'mbituart.soundMenu.So': 'ソ',
				'mbituart.soundMenu.SoS': 'ソ#',
				'mbituart.soundMenu.Ra': 'ラ',
				'mbituart.soundMenu.RaS': 'ラ#',
				'mbituart.soundMenu.Shi': 'シ',
				'mbituart.soundLengthMenu.Len1': '1拍',
				'mbituart.soundLengthMenu.Len2': '1/2拍',
				'mbituart.soundLengthMenu.Len4': '1/4拍',
				'mbituart.soundLengthMenu.Len8': '1/8拍',
				'mbituart.soundLengthMenu.Len16': '1/16拍',
				'mbituart.soundLevelMenu.Mid': '中音',
				'mbituart.soundLevelMenu.High': '高音',
				'mbituart.soundLevelMenu.Low': '低音',
				'mbituart.playExpress': '[EXPRESS]を鳴らす',
				'mbituart.getPlaySound': '演奏中',
		        'mbituart.expressMenu.giggle': 'クスクス笑う',
				'mbituart.expressMenu.happy': 'ハッピー',
				'mbituart.expressMenu.hello': 'ハロー',
				'mbituart.expressMenu.mysterious': '神秘的',
				'mbituart.expressMenu.sad': '寂しい',
				'mbituart.expressMenu.slide': 'スライド',
				'mbituart.expressMenu.soaring': '急上昇',
				'mbituart.expressMenu.spring': '春',
				'mbituart.expressMenu.twinkle': 'きらめく',
				'mbituart.expressMenu.yawn': 'あくび',
				'mbituart.pinModeMenu.none': '使わない',
				'mbituart.pinModeMenu.onoff': 'デジタルで使う',
				'mbituart.pinModeMenu.value': 'アナログで使う',
			}
		};
		for (const locale in extTranslations) {
			if (!localeSetup.translations[locale]) {
				localeSetup.translations[locale] = {};
			}
			Object.assign(localeSetup.translations[locale], extTranslations[locale]);
		}
	}
}

module.exports = Scratch3_MBitUART_Blocks;
