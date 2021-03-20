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
			this._runtime._mbitlink = { instance: null, extensions: [this] };
		} else {
			this._runtime._mbitlink.extensions[
				this._runtime._mbitlink.extensions.length] = this;
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
			this._runtime._mbitlink.instance.send(cmd + data); 
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
		if(data[0] == 'T') {
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
					default: 'any',
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
					default: 'roll',
					description: 'label for rotate picker'
				}),
				value: MBitUART_Rotation.ROLL
			},
			{
				text: formatMessage({
					id: 'mbituart.rotationMenu.pitch',
					default: 'pitch',
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
					default: 'enable',
					description: 'label for enable picker'
				}),
				value: MBitUART_Enable.ENABLE
			},
			{
				text: formatMessage({
					id: 'mbituart.enableManu.disable',
					default: 'disable',
					description: 'label for enable picker'
				}),
				value: MBitUART_Enable.DISABLE
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
                    default: 'front',
                    description: 'label for front element in tilt direction picker for micro:bit extension'
                }),
                value: MBitUART_TiltDirection.FRONT
            },
            {
                text: formatMessage({
                    id: 'mbituart.tiltDirectionMenu.back',
                    default: 'back',
                    description: 'label for back element in tilt direction picker for micro:bit extension'
                }),
                value: MBitUART_TiltDirection.BACK
            },
            {
                text: formatMessage({
                    id: 'mbituart.tiltDirectionMenu.left',
                    default: 'left',
                    description: 'label for left element in tilt direction picker for micro:bit extension'
                }),
                value: MBitUART_TiltDirection.LEFT
            },
            {
                text: formatMessage({
                    id: 'mbituart.tiltDirectionMenu.right',
                    default: 'right',
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
					default: 'any',
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
			blockIconURI: blockIconURI,
			//showStatusButton: true,
			blocks: [
				{
					opcode: 'whenLogoTouched',
					text: formatMessage({
						id: 'mbituart.whenLogoTouched',
						default: 'when logo touched',
						description: 'when the logo on the micro:bit is touched'
					}),
					blockType: BlockType.HAT
				},
				{
					opcode: 'isLogoTouched',
					text: formatMessage({
						id: 'mbituart.isLogoTouched',
						default: 'logo touched?',
						description: 'is the logo on the micro:bit touched?'
					}),
					blockType: BlockType.BOOLEAN
				},
				{
					opcode: 'whenButtonPressed',
					text: formatMessage({
						id: 'mbituart.whenButtonPressed',
						default: 'when [BTN] button pressed',
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
						default: 'light level',
						description: 'light level'
					}),
					blockType: BlockType.REPORTER
				},
				{
					opcode: 'getTemperature',
					text: formatMessage({
						id: 'mbituart.getTemperature',
						default: 'temperature',
						description: 'temperature'
					}),
					blockType: BlockType.REPORTER
				},
				{
					opcode: 'whenPinConnected',
					text: formatMessage({
						id: 'mbituart.whenPinConnected',
						default: 'when pin [PIN] connected',
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
						default: 'when pin [PIN] connected',
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
					opcode: 'whenGesture',
					text: formatMessage({
						id: 'mbituart.whenGesture',
						default: 'when [GESTURE]',
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
						default: 'get Gesture',
						description: 'get gesture'
					}),
					blockType: BlockType.REPORTER
				},
				{
					opcode: 'setSensor',
					text: formatMessage({
						id: 'mbituart.setSensor',
						default: '[ENABLE] basic sensor(logo, buttons, light level, temperature and pins)',
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
						default: 'display [MATRIX]',
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
						default: 'display text [TEXT]',
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
						default: 'clear display',
						description: 'display nothing on the micro:bit display'
					}),
					blockType: BlockType.COMMAND
				},
				'---',
				{
					opcode: 'getAcceleration',
					text: formatMessage({
						id: 'mbituart.getAcceleration',
						default: 'acceleration [AXIS]',
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
						id: 'mbituart.sensorAcceleration',
						default: 'round [ROUND] of acceleration',
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
						default: 'magnetic force [AXIS]',
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
						id: 'mbituart.sensorMagneticForce',
						default: 'round [ROUND] of magnetic force',
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
						default: 'when tilted [DIRECTION]',
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
						default: 'tilted [DIRECTION]?',
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
						default: 'rotation [ROTATION]',
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
						id: 'mbituart.sensorRotation',
						default: 'round [ROUND] of rotation',
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

	setSensor (args) {
		this.command(CMD.SENSOR, (args.ENABLE == 0)? "0" : "31");
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
			    "mbituart.whenTilted": "[DIRECTION]に傾いたとき",
				'mbituart.whenLogoTouched': 'ロゴがタッチされたとき',
				'mbituart.isLogoTouched':"ロゴがタッチされた",
				'mbituart.getLightLevel': '明るさセンサー',
				'mbituart.getTemperature': '温度センサー',
				'mbituart.getAcceleration': '加速度センサー[AXIS]',
				'mbituart.getMagneticForce': '磁力センサー[AXIS]',
				'mbituart.getRotation': '回転センサー[ROTATION]',
				'mbituart.setSensor': '基本センサー(ロゴ,ボタン,明るさ,温度など)を[ENABLE]',
				'mbituart.sensorMagneticForce': '磁力センサーを[ROUND]でまるめる',
				'mbituart.sensorAcceleration': '加速度センサーを[ROUND]でまるめる',
				'mbituart.sensorRotation': '回転センサーを[ROUND]でまるめる',
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
				'mbituart.gesturesMenu.tiltforward': 'ロゴが上になった'
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
